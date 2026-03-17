import { Client } from 'colyseus.js';

export class ColyseusGateway {
  private readonly client: Client;

  constructor(endpoint = 'ws://localhost:2567') {
    this.client = new Client(endpoint);
  }

  isReady(): boolean {
    return this.client !== null;
  }
}
