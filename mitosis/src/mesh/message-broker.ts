import {Subject} from 'rxjs';
import {filter} from 'rxjs/operators';
import {
  ConnectionState,
  IConnection,
  IWebRTCConnectionOptions,
  Protocol,
  WebRTCConnectionOptionsPayloadType
} from '../connection/interface';
import {ViaConnection} from '../connection/via';
import {WebRTCConnection} from '../connection/webrtc';
import {Logger} from '../logger/logger';
import {Address} from '../message/address';
import {ConnectionNegotiation, ConnectionNegotiationType} from '../message/connection-negotiation';
import {MessageSubject} from '../message/interface';
import {Message} from '../message/message';
import {PeerUpdate} from '../message/peer-update';
import {RoleUpdate} from '../message/role-update';
import {ChurnType} from './interface';
import {RemotePeer} from './remote-peer';
import {RoleManager} from './role-manager';
import {RoutingTable} from './routing-table';

export class MessageBroker {

  private _routingTable: RoutingTable;
  private _roleManager: RoleManager;
  private _appContentMessagesSubject: Subject<Message>;
  private _appMessagesSubject: Subject<Message>;

  constructor(routingTable: RoutingTable, roleManager: RoleManager) {
    this._routingTable = routingTable;
    this.listenOnRoutingTablePeerChurn();
    this._roleManager = roleManager;
    this._appContentMessagesSubject = new Subject();
    this._appMessagesSubject = new Subject();
  }

  private listenOnRoutingTablePeerChurn(): void {
    this._routingTable.observePeerChurn()
      .pipe(
        filter(ev => ev.type === ChurnType.ADDED)
      )
      .subscribe(
        ev => this.listenOnConnectionChurn(ev.peer)
      );
  }

  private listenOnConnectionChurn(remotePeer: RemotePeer): void {
    Logger.getLogger(this._routingTable.getMyId()).info(`added ${remotePeer.getId()}`);
    remotePeer.observeChurn()
      .pipe(
        filter(ev => ev.type === ChurnType.ADDED)
      )
      .subscribe(
        ev => this.listenOnConnectionAdded(ev.connection)
      );
  }

  private listenOnConnectionAdded(connection: IConnection): void {
    connection.observeMessageReceived()
      .subscribe(
        message => {
          this.handleMessage(message, connection);
        }
      );
  }

  private ensureViaConnection(sender: Address, via: Address): void {
    if (
      sender.getId() !== via.getId() &&
      sender.getId() !== this._routingTable.getMyId()
    ) {
      const viaAddress = new Address(
        sender.getId(),
        Protocol.VIA,
        via.getId()
      );
      this._routingTable.connectTo(viaAddress);
    }
  }

  private handleMessage(message: Message, connection: IConnection): void {
    if (message.getReceiver().getId() === this._routingTable.getMyId()) {
      this.receiveMessage(message, connection);
    } else {
      this.forwardMessage(message);
    }
  }

  private receiveMessage(message: Message, connection: IConnection): void {
    this.ensureViaConnection(message.getSender(), connection.getAddress());
    switch (message.getSubject()) {
      case MessageSubject.ROLE_UPDATE:
        // TODO: Only accept role update from superior
        this.updateRoles(message as RoleUpdate);
        break;
      case MessageSubject.PEER_UPDATE:
        if (message.getSender().getId() === connection.getAddress().getId()) {
          this.updatePeers(message as PeerUpdate);
        } else {
          throw new Error(
            `${message.getReceiver()} will not accept peer update from ` +
            `${message.getSender()} via ${connection.getAddress()}`
          );
        }
        break;
      case MessageSubject.CONNECTION_NEGOTIATION:
        this.negotiateConnection(message as ConnectionNegotiation);
        break;
      case MessageSubject.APP_CONTENT:
        this._appContentMessagesSubject.next(message);
        break;
      default:
        throw new Error(`unsupported subject ${message.getSubject()}`);
    }
    this._appMessagesSubject.next(message);
  }

  private updateRoles(roleUpdate: RoleUpdate): void {
    this._roleManager.updateRoles(roleUpdate.getBody());
  }

  private updatePeers(peerUpdate: PeerUpdate): void {
    peerUpdate.getBody()
      .forEach(
        entry => {
          if (entry.peerId !== this._routingTable.getMyId()) {
            const address = new Address(
              entry.peerId,
              Protocol.VIA,
              peerUpdate.getSender().getId()
            );
            this._routingTable.connectTo(address);
          }
        }
      );
  }

  private negotiateConnection(connectionNegotiation: ConnectionNegotiation): void {
    const senderAddress = connectionNegotiation.getSender();
    const options: IWebRTCConnectionOptions = {
      protocol: Protocol.WEBRTC,
      mitosisId: this._routingTable.getMyId(),
      payload: {
        type: connectionNegotiation.getBody().type as unknown as WebRTCConnectionOptionsPayloadType,
        sdp: connectionNegotiation.getBody().sdp
      }
    };
    switch (connectionNegotiation.getBody().type) {
      case ConnectionNegotiationType.OFFER:
        this._routingTable.connectTo(senderAddress, options);
        break;
      case ConnectionNegotiationType.ANSWER:
        this._routingTable.connectTo(senderAddress).then(remotePeer => {
          const webRTCConnecton: WebRTCConnection =
            remotePeer.getConnectionForAddress(senderAddress) as WebRTCConnection;
          webRTCConnecton.establish(options.payload);
        });
        break;
      default:
        throw new Error(
          `unsupported connection negotiation type ${connectionNegotiation.getType()}`
        );
    }
  }

  private forwardMessage(message: Message): void {
    const peerId = message.getReceiver().getId();
    const receiverPeer = this._routingTable.getPeerById(peerId);
    const connection = receiverPeer.getConnectionTable()
      .filterByStates(ConnectionState.OPEN)
      .sortByQuality()
      .shift();
    let directPeer;
    if (!connection) {
      Logger.getLogger(this._routingTable.getMyId()).error('all connections lost to', receiverPeer.getId());
    } else if (connection instanceof ViaConnection) {
      const directPeerId = connection.getAddress().getLocation();
      directPeer = this._routingTable.getPeerById(directPeerId);
      directPeer.send(message);
    } else {
      receiverPeer.send(message);
    }
  }

  public observeAppContentMessages() {
    return this._appContentMessagesSubject;
  }

  public observeMessages() {
    return this._appMessagesSubject;
  }
}
