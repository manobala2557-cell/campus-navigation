import { WebSocketServer, WebSocket } from 'ws';

type EdgeOperationalStatus = 'ACTIVE' | 'MAINTENANCE' | 'BLOCKED';

interface MeetMeSession {
  sessionId: string;
  creatorLabel: string;
  nodeId: string;
  level: number;
  x: number;
  y: number;
  z: number;
  expiresAt: number;
}

type WSMessage =
  | {
      type: 'INIT_STATE';
      edgeStates: Record<string, EdgeOperationalStatus>;
      emergencyActive: boolean;
      meetSessions: Record<string, MeetMeSession>;
      customOsmPackage: unknown | null;
    }
  | { type: 'TOGGLE_EDGE_STATUS'; edgeId: string; status: EdgeOperationalStatus; updatedBy: string }
  | { type: 'BROADCAST_EVACUATION'; active: boolean; reason: string }
  | { type: 'CREATE_MEET_ME'; session: MeetMeSession }
  | { type: 'UPDATE_OSM_MAP'; osmPackage: unknown; updatedBy: string };

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

let liveEdgeStates: Record<string, EdgeOperationalStatus> = {};
let facilityEmergencyActive = false;
let customOsmPackage: unknown | null = null;
const meetSessions: Record<string, MeetMeSession> = {};

function broadcast(message: WSMessage): void {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws: WebSocket) => {
  const initMsg: WSMessage = {
    type: 'INIT_STATE',
    edgeStates: liveEdgeStates,
    emergencyActive: facilityEmergencyActive,
    meetSessions,
    customOsmPackage
  };
  ws.send(JSON.stringify(initMsg));

  ws.on('message', (raw: string) => {
    try {
      const msg = JSON.parse(raw.toString()) as WSMessage;
      if (msg.type === 'TOGGLE_EDGE_STATUS') {
        liveEdgeStates[msg.edgeId] = msg.status;
        broadcast(msg);
      } else if (msg.type === 'BROADCAST_EVACUATION') {
        facilityEmergencyActive = msg.active;
        broadcast(msg);
      } else if (msg.type === 'CREATE_MEET_ME') {
        meetSessions[msg.session.sessionId] = msg.session;
        broadcast(msg);
      } else if (msg.type === 'UPDATE_OSM_MAP') {
        customOsmPackage = msg.osmPackage;
        liveEdgeStates = {};
        broadcast(msg);
      }
    } catch (err) {
      console.error('Invalid WebSocket payload:', err);
    }
  });
});

console.log(`[Incident & OSM Sync Server] Active on ws://localhost:${PORT}`);