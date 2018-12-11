import {Peer} from '../mesh/peer';
import {IRole} from './interface';
import {AbstractRole} from './role';

export class Router extends AbstractRole implements IRole {
  private parent: Peer;
  private succession: Array<Peer>;

  public advertise(): void {
  }

  public introduce(offer: any): void {
  }

  protected _onTick(): void {
  }

  protected _initialise(): Promise<void> {
    return undefined;
  }
}
