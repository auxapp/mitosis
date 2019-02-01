import {ConnectionMeter} from './connection-meter';
import {IConnectionMeter} from './interface';

export class StreamConnectionMeter extends ConnectionMeter implements IConnectionMeter {
  public getQuality(): number {
    // TODO: Get quality from WebRTCPeerConnection
    return 1;
  }

  public start(): void {
  }

  public stop(): void {
  }
}
