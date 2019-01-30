import {Component, Input, OnInit} from '@angular/core';
import {ConnectionState, RemotePeer, RoleType} from 'mitosis';
import {Node, Simulation} from 'mitosis-simulation';

@Component({
  selector: 'app-peer-table',
  templateUrl: './peer-table.html',
  styleUrls: ['./peer-table.scss'],
})
export class PeerTableComponent implements OnInit {
  @Input()
  public selectedNode: Node;

  @Input()
  public simulation: Simulation;

  constructor() {
  }

  public getPeerAnnotation(peer: RemotePeer) {
    const roles = peer.getRoles()
      .filter(roleType => roleType !== RoleType.PEER)
      .map(roleType => roleType.toString()[0].toUpperCase());
    const roleTag = roles.length ? `[${roles.join(', ')}]` : '';

    const quality = peer.getQuality()
      .toFixed(2)
      .toString();

    const directConnections = peer.getConnectionTable()
      .filterDirect();
    const nonOpenConnections = directConnections
      .exclude(table => table.filterByStates(ConnectionState.OPEN));
    const directText = `${directConnections.length - nonOpenConnections.length}/${directConnections.length}`;

    const viaText = peer.getConnectionTable()
      .filterVia()
      .length
      .toString();

    return `${roleTag} ${quality}✫ ${directText}← ${viaText}⤺`;
  }

  ngOnInit(): void {
  }
}
