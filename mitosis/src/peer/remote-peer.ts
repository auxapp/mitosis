import {Subject} from 'rxjs';
import {IClock} from '../clock/interface';
import {ConnectionTable} from '../connection/connection-table';
import {ConnectionState, IConnection, IConnectionChurnEvent, IConnectionOptions} from '../connection/interface';
import {ProtocolConnectionMap} from '../connection/protocol-map';
import {ChurnType} from '../interface';
import {Logger} from '../logger/logger';
import {Address} from '../message/address';
import {Message} from '../message/message';
import {RoleType} from '../role/interface';

export class RemotePeer {

  private _id: string;
  private _clock: IClock;
  private _mitosisId: string;
  private _publicKey: string;
  private _roleTypes: Array<RoleType>;
  private _connectionsPerAddress: Map<string, IConnection>;
  private _openConnectionPromises: Map<IConnection, Promise<RemotePeer>>;
  private _connectionChurnSubject: Subject<IConnectionChurnEvent>;

  public constructor(id: string, mitosisId: string, clock: IClock) {
    this._id = id;
    this._mitosisId = mitosisId;
    this._clock = clock;
    this._roleTypes = [RoleType.PEER];
    this._connectionsPerAddress = new Map();
    this._openConnectionPromises = new Map();
    this._connectionChurnSubject = new Subject();
  }

  public getId(): string {
    return this._id;
  }

  public getRoles(): Array<RoleType> {
    return this._roleTypes;
  }

  public setRoles(roleTypes: Array<RoleType>): void {
    this._roleTypes = roleTypes;
  }

  public getPublicKey(): string {
    return this._publicKey;
  }

  public getConnectionTable(): ConnectionTable {
    return ConnectionTable.fromIterable(
      this._connectionsPerAddress.values()
    );
  }

  public getQuality(): number {
    return this.getConnectionTable().getAverageQuality();
  }

  public getConnectionForAddress(address: Address): IConnection {
    return this._connectionsPerAddress.get(address.toString());
  }

  private listenOnConnectionChanges(connection: IConnection) {
    connection.observeStateChange().subscribe((ev) => {
      switch (ev) {
        case ConnectionState.CLOSED:
          this._connectionsPerAddress.delete(connection.getAddress().toString());
          break;
      }
      Logger.getLogger(this._mitosisId).debug(`connection ${ev.toString()}`, connection);
    });
  }

  private openConnection(connection: IConnection): Promise<RemotePeer> {
    let promise = this._openConnectionPromises.get(connection);
    if (!promise) {
      switch (connection.getState()) {
        case ConnectionState.OPEN:
          promise = Promise.resolve(this);
          break;
        case ConnectionState.CLOSING:
        case ConnectionState.ERROR:
          promise = Promise.reject(this);
          break;
        case ConnectionState.CLOSED:
          promise = new Promise<RemotePeer>((resolve, reject) => {
            connection.open()
              .then(() => {
                resolve(this);
              })
              .catch((reason: any) => {
                reject(reason);
              })
              .finally(() => {
                this._openConnectionPromises.delete(connection);
              });
          });
          this._openConnectionPromises.set(connection, promise);
          break;
        default:
          throw new Error('opening connection should be in map');
      }
    }
    return promise;
  }

  private createConnection(address: Address, options?: IConnectionOptions): IConnection {
    options = options || {};
    options.mitosisId = options.mitosisId || this._mitosisId;
    options.clock = options.clock || this._clock.fork();

    const connectionClass = ProtocolConnectionMap.get(address.getProtocol());
    if (!connectionClass) {
      throw new Error(`unsupported protocol ${address.getProtocol()}`);
    }
    const connection = new connectionClass(address, options);
    this._connectionsPerAddress.set(address.toString(), connection);
    this._connectionChurnSubject.next({connection: connection, type: ChurnType.ADDED});
    this.listenOnConnectionChanges(connection);
    return connection;
  }

  public hasRole(...roleTypes: Array<RoleType>): boolean {
    return this._roleTypes
      .filter(roleType => roleTypes.indexOf(roleType) >= 0)
      .length > 0;
  }

  public connect(address: Address, options?: IConnectionOptions): Promise<RemotePeer> {
    let connection = this._connectionsPerAddress.get(address.toString());
    if (!connection) {
      connection = this.createConnection(address, options);
    }
    return this.openConnection(connection);
  }

  public send(message: Message): void {
    const connection: IConnection = this.getConnectionTable()
      .filterByStates(ConnectionState.OPEN)
      .filterDirect()
      .sortByQuality()
      .shift();
    if (connection) {
      try {
        connection.send(message);
      } catch (error) {
        Logger.getLogger(this._mitosisId).error(error);
        connection.close();
      }
    } else {
      Logger.getLogger(this._mitosisId)
        .error(`no direct connection to ${message.getReceiver().getId()}`, message);
    }
  }

  public observeChurn(): Subject<IConnectionChurnEvent> {
    return this._connectionChurnSubject;
  }

  public toString() {
    return JSON.stringify({
        id: this._id,
        roles: this._roleTypes,
        connections: Array.from(this._connectionsPerAddress.keys())
      },
      undefined,
      2
    );
  }

  public destroy(): void {
    this._connectionsPerAddress.forEach(
      connection => connection.close()
    );
    this.observeChurn().subscribe(
      () => {
        if (this._connectionsPerAddress.size === 0) {
          this._connectionChurnSubject.complete();
        }
      }
    );
    this._clock.stop();
  }
}
