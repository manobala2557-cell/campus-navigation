import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Compass,
  Shield,
  Wifi,
  WifiOff,
  QrCode,
  Navigation,
  Accessibility,
  Layers,
  AlertTriangle,
  ShieldAlert,
  Volume2,
  VolumeX,
  Hash,
  Camera,
  CheckCircle2,
  X,
  Wrench,
  CheckCircle,
  Ban,
  Radio,
  Printer,
  LogOut,
  Lock,
  UserCheck,
  Upload,
  Download,
  FileJson,
  RefreshCw,
  PenTool,
  Trash2,
  Check,
  Move,
  Plus,
  Maximize2,
  Link2,
  FlipHorizontal,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

// ============================================================================
// 1. SPATIAL, OSM PACKAGE, ROUTING & WEBSOCKET SCHEMAS
// ============================================================================
export type RoomCategory = string;

export type VerticalTransitType = 'none' | 'stairs' | 'fire_escape' | 'elevator' | 'service_lift' | 'ramp';
export type LifeSafetyFeatureType = 'none' | 'emergency_exit' | 'fire_hose_cabinet' | 'aed' | 'muster_point' | 'water_fountain';
export type EdgeOperationalStatus = 'ACTIVE' | 'MAINTENANCE' | 'BLOCKED';
export type RoutingProfile = 'STANDARD' | 'WHEELCHAIR_ADA' | 'VISUALLY_IMPAIRED' | 'HEARING_IMPAIRED' | 'EMERGENCY_EVACUATION';

export interface QRLandmarkAnchor {
  landmarkId: string;
  shortCode: string;
  buildingId: string;
  level: number;
  coordinates: { lat: number; lon: number; x: number; y: number; z: number };
  headingDeg: number;
  label: string;
  connectedNodeId: string;
}

export interface OSMIndoorFeature {
  id: string;
  name: string;
  buildingId: string;
  level: number;
  minHeight: number;
  height: number;
  category: RoomCategory;
  footprint: [number, number][];
  centroid: [number, number];
  widthMeters?: number;
  depthMeters?: number;
  connectedNodeId: string;
}

export interface GraphNode {
  id: string;
  label: string;
  buildingId: string;
  level: number;
  x: number;
  y: number;
  z: number;
  category?: RoomCategory;
  verticalTransit: VerticalTransitType;
  lifeSafety: LifeSafetyFeatureType;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distanceMeters: number;
  status: EdgeOperationalStatus;
  attributes: {
    isStairs: boolean;
    isElevator: boolean;
    isRamp: boolean;
    isTurnstile: boolean;
    isEscalator: boolean;
    rampInclinePercent: number;
    doorClearanceCm: number;
    corridorWidthCm: number;
    hasTactilePaving: boolean;
    isOpenAtrium: boolean;
    verticalTransitType: VerticalTransitType;
  };
}

export interface CampusOSMMapPackage {
  mapName: string;
  buildingId: string;
  updatedAt: string;
  levels: number[];
  canvasBounds: {
    widthMeters: number;
    depthMeters: number;
  };
  features: OSMIndoorFeature[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  anchors: QRLandmarkAnchor[];
}

export interface RouteInstruction {
  stepIndex: number;
  nodeId: string;
  level: number;
  distanceMeters: number;
  turnDirection: 'STRAIGHT' | 'LEFT' | 'RIGHT' | 'LEVEL_UP' | 'LEVEL_DOWN' | 'ARRIVE';
  textDirective: string;
  hapticPattern: number[];
}

export interface ComputedRoute {
  profile: RoutingProfile;
  isEmergencyEvacuation: boolean;
  stairsUsedCount: number;
  accessibleTransitUsed: string[];
  totalDistanceMeters: number;
  estimatedSeconds: number;
  pathNodes: GraphNode[];
  pathEdges: GraphEdge[];
  instructions: RouteInstruction[];
}

export interface UserPose {
  buildingId: string;
  level: number;
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  nearestNodeId: string;
  source: 'QR_SCAN' | 'SHORT_CODE_FAILOVER' | 'CHECKPOINT_SELECT';
  lastAnchorCode: string;
}

type WSMessage =
  | {
      type: 'INIT_STATE';
      edgeStates: Record<string, EdgeOperationalStatus>;
      emergencyActive: boolean;
      customOsmPackage?: CampusOSMMapPackage | null;
    }
  | { type: 'TOGGLE_EDGE_STATUS'; edgeId: string; status: EdgeOperationalStatus; updatedBy: string }
  | { type: 'BROADCAST_EVACUATION'; active: boolean; reason: string }
  | { type: 'UPDATE_OSM_MAP'; osmPackage: CampusOSMMapPackage; updatedBy: string };

const LOCAL_STORAGE_OSM_KEY = 'CAMPUS_LIVE_OSM_PACKAGE_V6';
const LOCAL_STORAGE_EDGES_KEY = 'CAMPUS_LIVE_EDGE_STATES_V6';

// ============================================================================
// 2. DEFAULT & PRESET OSM 3D CAMPUS PACKAGES
// ============================================================================
const baseCorridor = {
  isStairs: false,
  isElevator: false,
  isRamp: false,
  isTurnstile: false,
  isEscalator: false,
  rampInclinePercent: 0,
  doorClearanceCm: 120,
  corridorWidthCm: 240,
  hasTactilePaving: true,
  isOpenAtrium: false,
  verticalTransitType: 'none' as const
};

function makeRectFootprint(cx: number, cz: number, w: number, d: number): [number, number][] {
  const hw = Number((w / 2).toFixed(1));
  const hd = Number((d / 2).toFixed(1));
  return [
    [Number((cx - hw).toFixed(1)), Number((cz - hd).toFixed(1))],
    [Number((cx + hw).toFixed(1)), Number((cz - hd).toFixed(1))],
    [Number((cx + hw).toFixed(1)), Number((cz + hd).toFixed(1))],
    [Number((cx - hw).toFixed(1)), Number((cz + hd).toFixed(1))]
  ];
}

const DEFAULT_ACADEMIC_OSM_PACKAGE: CampusOSMMapPackage = {
  mapName: 'Main Engineering & Academic Block (BLD-ALPHA)',
  buildingId: 'BLD-ALPHA',
  updatedAt: new Date().toLocaleTimeString(),
  levels: [1, 2],
  canvasBounds: { widthMeters: 76, depthMeters: 56 },
  anchors: [
    {
      landmarkId: 'LM-MAIN-ENTRANCE',
      shortCode: 'FL1-A01',
      buildingId: 'BLD-ALPHA',
      level: 1,
      coordinates: { lat: 12.9716, lon: 77.5946, x: 0, y: 0, z: 20 },
      headingDeg: 0,
      label: 'Main Lobby North Threshold',
      connectedNodeId: 'N-L1-LOBBY'
    },
    {
      landmarkId: 'LM-L1-ELEVATOR',
      shortCode: 'FL1-E04',
      buildingId: 'BLD-ALPHA',
      level: 1,
      coordinates: { lat: 12.9717, lon: 77.5946, x: 0, y: 0, z: 0 },
      headingDeg: 90,
      label: 'Level 1 Central Elevator Bank',
      connectedNodeId: 'N-L1-ELEV'
    },
    {
      landmarkId: 'LM-L1-WEST-HALL',
      shortCode: 'FL1-W09',
      buildingId: 'BLD-ALPHA',
      level: 1,
      coordinates: { lat: 12.9717, lon: 77.5944, x: -22, y: 0, z: 8 },
      headingDeg: 270,
      label: 'Level 1 West Medical Corridor',
      connectedNodeId: 'N-L1-WEST'
    },
    {
      landmarkId: 'LM-L2-ELEVATOR',
      shortCode: 'FL2-E14',
      buildingId: 'BLD-ALPHA',
      level: 2,
      coordinates: { lat: 12.9717, lon: 77.5946, x: 0, y: 4.5, z: 0 },
      headingDeg: 180,
      label: 'Level 2 Elevator Lobby',
      connectedNodeId: 'N-L2-ELEV'
    },
    {
      landmarkId: 'LM-L2-EAST-HALL',
      shortCode: 'FL2-C22',
      buildingId: 'BLD-ALPHA',
      level: 2,
      coordinates: { lat: 12.9717, lon: 77.5948, x: 20, y: 4.5, z: 10 },
      headingDeg: 90,
      label: 'Level 2 East Academic Wing',
      connectedNodeId: 'N-L2-EAST'
    }
  ],
  nodes: [
    { id: 'N-OUT-MUSTER', label: 'Outdoor Assembly Muster Point A', buildingId: 'BLD-ALPHA', level: 1, x: 0, y: 0, z: 26, category: 'corridor', verticalTransit: 'none', lifeSafety: 'muster_point' },
    { id: 'N-L1-LOBBY', label: 'Main Lobby Entrance', buildingId: 'BLD-ALPHA', level: 1, x: 0, y: 0, z: 18, category: 'lobby', verticalTransit: 'none', lifeSafety: 'emergency_exit' },
    { id: 'N-L1-CENTER', label: 'Level 1 Central Corridor Hub', buildingId: 'BLD-ALPHA', level: 1, x: 0, y: 0, z: 8, category: 'corridor', verticalTransit: 'none', lifeSafety: 'aed' },
    { id: 'N-L1-ELEV', label: 'Level 1 Wheelchair Passenger Elevator', buildingId: 'BLD-ALPHA', level: 1, x: 0, y: 0, z: 0, category: 'corridor', verticalTransit: 'elevator', lifeSafety: 'none' },
    { id: 'N-L1-STAIRS', label: 'Level 1 West Stairwell (Stairs)', buildingId: 'BLD-ALPHA', level: 1, x: -12, y: 0, z: 0, category: 'corridor', verticalTransit: 'stairs', lifeSafety: 'none' },
    { id: 'N-L1-RAMP', label: 'Level 1 North ADA Wheelchair Ramp', buildingId: 'BLD-ALPHA', level: 1, x: 12, y: 0, z: 0, category: 'corridor', verticalTransit: 'ramp', lifeSafety: 'none' },
    { id: 'N-L1-WEST', label: 'Medical Clinic & First Aid 101', buildingId: 'BLD-ALPHA', level: 1, x: -22, y: 0, z: 8, category: 'medical_room', verticalTransit: 'none', lifeSafety: 'water_fountain' },
    { id: 'N-L1-RESTROOM', label: 'Accessible Restroom 102', buildingId: 'BLD-ALPHA', level: 1, x: 22, y: 0, z: 8, category: 'accessible_restroom', verticalTransit: 'none', lifeSafety: 'none' },
    { id: 'N-L1-FIRE-EXIT-W', label: 'West Ground Emergency Fire Exit', buildingId: 'BLD-ALPHA', level: 1, x: -28, y: 0, z: 0, category: 'corridor', verticalTransit: 'none', lifeSafety: 'emergency_exit' },

    { id: 'N-L2-ELEV', label: 'Level 2 Wheelchair Passenger Elevator', buildingId: 'BLD-ALPHA', level: 2, x: 0, y: 4.5, z: 0, category: 'corridor', verticalTransit: 'elevator', lifeSafety: 'none' },
    { id: 'N-L2-STAIRS', label: 'Level 2 West Stairwell (Stairs)', buildingId: 'BLD-ALPHA', level: 2, x: -12, y: 4.5, z: 0, category: 'corridor', verticalTransit: 'stairs', lifeSafety: 'fire_hose_cabinet' },
    { id: 'N-L2-RAMP', label: 'Level 2 North ADA Ramp Landing', buildingId: 'BLD-ALPHA', level: 2, x: 12, y: 4.5, z: 0, category: 'corridor', verticalTransit: 'ramp', lifeSafety: 'none' },
    { id: 'N-L2-CENTER', label: 'Level 2 Central Corridor Walkway', buildingId: 'BLD-ALPHA', level: 2, x: 0, y: 4.5, z: 10, category: 'corridor', verticalTransit: 'none', lifeSafety: 'water_fountain' },
    { id: 'N-L2-CONF-302', label: 'Conference Room 302', buildingId: 'BLD-ALPHA', level: 2, x: -20, y: 4.5, z: 10, category: 'office', verticalTransit: 'none', lifeSafety: 'none' },
    { id: 'N-L2-EAST', label: 'Lecture Hall 204', buildingId: 'BLD-ALPHA', level: 2, x: 20, y: 4.5, z: 10, category: 'lecture_hall', verticalTransit: 'none', lifeSafety: 'none' },
    { id: 'N-L2-CAFE', label: 'Skyline Cafeteria', buildingId: 'BLD-ALPHA', level: 2, x: 0, y: 4.5, z: 20, category: 'cafeteria', verticalTransit: 'none', lifeSafety: 'aed' }
  ],
  edges: [
    { id: 'E-MUSTER-LOBBY', fromNodeId: 'N-OUT-MUSTER', toNodeId: 'N-L1-LOBBY', distanceMeters: 8, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-LOBBY-CENTER', fromNodeId: 'N-L1-LOBBY', toNodeId: 'N-L1-CENTER', distanceMeters: 10, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L1-CENTER-ELEV', fromNodeId: 'N-L1-CENTER', toNodeId: 'N-L1-ELEV', distanceMeters: 8, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L1-CENTER-WEST', fromNodeId: 'N-L1-CENTER', toNodeId: 'N-L1-WEST', distanceMeters: 22, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L1-CENTER-REST', fromNodeId: 'N-L1-CENTER', toNodeId: 'N-L1-RESTROOM', distanceMeters: 22, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L1-ELEV-STAIRS', fromNodeId: 'N-L1-ELEV', toNodeId: 'N-L1-STAIRS', distanceMeters: 12, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L1-ELEV-RAMP', fromNodeId: 'N-L1-ELEV', toNodeId: 'N-L1-RAMP', distanceMeters: 12, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L1-WEST-STAIRS', fromNodeId: 'N-L1-WEST', toNodeId: 'N-L1-STAIRS', distanceMeters: 10, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L1-STAIRS-EXITW', fromNodeId: 'N-L1-STAIRS', toNodeId: 'N-L1-FIRE-EXIT-W', distanceMeters: 16, status: 'ACTIVE', attributes: { ...baseCorridor } },

    { id: 'E-VERT-STAIRS', fromNodeId: 'N-L1-STAIRS', toNodeId: 'N-L2-STAIRS', distanceMeters: 7, status: 'ACTIVE', attributes: { ...baseCorridor, isStairs: true, verticalTransitType: 'stairs' } },
    { id: 'E-VERT-ELEV', fromNodeId: 'N-L1-ELEV', toNodeId: 'N-L2-ELEV', distanceMeters: 10, status: 'ACTIVE', attributes: { ...baseCorridor, isElevator: true, verticalTransitType: 'elevator' } },
    { id: 'E-VERT-RAMP', fromNodeId: 'N-L1-RAMP', toNodeId: 'N-L2-RAMP', distanceMeters: 24, status: 'ACTIVE', attributes: { ...baseCorridor, isRamp: true, rampInclinePercent: 7.5, verticalTransitType: 'ramp' } },

    { id: 'E-L2-ELEV-CENTER', fromNodeId: 'N-L2-ELEV', toNodeId: 'N-L2-CENTER', distanceMeters: 10, status: 'ACTIVE', attributes: { ...baseCorridor, isOpenAtrium: true, hasTactilePaving: false } },
    { id: 'E-L2-ELEV-STAIRS', fromNodeId: 'N-L2-ELEV', toNodeId: 'N-L2-STAIRS', distanceMeters: 12, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L2-ELEV-RAMP', fromNodeId: 'N-L2-ELEV', toNodeId: 'N-L2-RAMP', distanceMeters: 12, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L2-STAIRS-CONF', fromNodeId: 'N-L2-STAIRS', toNodeId: 'N-L2-CONF-302', distanceMeters: 9, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L2-CENTER-CONF', fromNodeId: 'N-L2-CENTER', toNodeId: 'N-L2-CONF-302', distanceMeters: 20, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L2-CENTER-EAST', fromNodeId: 'N-L2-CENTER', toNodeId: 'N-L2-EAST', distanceMeters: 20, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L2-RAMP-EAST', fromNodeId: 'N-L2-RAMP', toNodeId: 'N-L2-EAST', distanceMeters: 13, status: 'ACTIVE', attributes: { ...baseCorridor } },
    { id: 'E-L2-CENTER-CAFE', fromNodeId: 'N-L2-CENTER', toNodeId: 'N-L2-CAFE', distanceMeters: 10, status: 'ACTIVE', attributes: { ...baseCorridor } }
  ],
  features: [
    { id: 'OSM-L1-LOBBY', name: 'Main Entrance Lobby', buildingId: 'BLD-ALPHA', level: 1, minHeight: 0, height: 3.8, category: 'lobby', widthMeters: 16, depthMeters: 10, footprint: makeRectFootprint(0, 18, 16, 10), centroid: [0, 18], connectedNodeId: 'N-L1-LOBBY' },
    { id: 'OSM-L1-MED', name: 'Medical Clinic 101', buildingId: 'BLD-ALPHA', level: 1, minHeight: 0, height: 3.8, category: 'medical_room', widthMeters: 12, depthMeters: 10, footprint: makeRectFootprint(-22, 8, 12, 10), centroid: [-22, 8], connectedNodeId: 'N-L1-WEST' },
    { id: 'OSM-L1-REST', name: 'Accessible Restroom 102', buildingId: 'BLD-ALPHA', level: 1, minHeight: 0, height: 3.8, category: 'accessible_restroom', widthMeters: 12, depthMeters: 10, footprint: makeRectFootprint(22, 8, 12, 10), centroid: [22, 8], connectedNodeId: 'N-L1-RESTROOM' },
    { id: 'OSM-L2-CONF302', name: 'Conference Room 302', buildingId: 'BLD-ALPHA', level: 2, minHeight: 4.5, height: 3.8, category: 'office', widthMeters: 14, depthMeters: 10, footprint: makeRectFootprint(-20, 10, 14, 10), centroid: [-20, 10], connectedNodeId: 'N-L2-CONF-302' },
    { id: 'OSM-L2-LH204', name: 'Lecture Hall 204', buildingId: 'BLD-ALPHA', level: 2, minHeight: 4.5, height: 3.8, category: 'lecture_hall', widthMeters: 14, depthMeters: 10, footprint: makeRectFootprint(20, 10, 14, 10), centroid: [20, 10], connectedNodeId: 'N-L2-EAST' },
    { id: 'OSM-L2-CAFE', name: 'Skyline Cafeteria', buildingId: 'BLD-ALPHA', level: 2, minHeight: 4.5, height: 3.8, category: 'cafeteria', widthMeters: 20, depthMeters: 9, footprint: makeRectFootprint(0, 20, 20, 9), centroid: [0, 20], connectedNodeId: 'N-L2-CAFE' }
  ]
};

const HOSPITAL_RESEARCH_OSM_PACKAGE: CampusOSMMapPackage = {
  ...DEFAULT_ACADEMIC_OSM_PACKAGE,
  mapName: 'Bio-Medical Research & Hospital Wing (BLD-OMEGA)',
  buildingId: 'BLD-OMEGA',
  updatedAt: new Date().toLocaleTimeString(),
  nodes: DEFAULT_ACADEMIC_OSM_PACKAGE.nodes.map((n) => {
    if (n.id === 'N-L2-CONF-302') return { ...n, label: 'MRI & Radiology Suite 302', category: 'medical_room' };
    if (n.id === 'N-L2-EAST') return { ...n, label: 'Surgical Recovery Ward 204', category: 'medical_room' };
    if (n.id === 'N-L2-CAFE') return { ...n, label: 'Doctor & Visitor Dining Hall', category: 'cafeteria' };
    if (n.id === 'N-L1-WEST') return { ...n, label: 'Emergency Triage & Pharmacy 101', category: 'medical_room' };
    return n;
  }),
  features: [
    { id: 'OSM-L1-LOBBY', name: 'Hospital Main Reception', buildingId: 'BLD-OMEGA', level: 1, minHeight: 0, height: 3.8, category: 'lobby', widthMeters: 18, depthMeters: 10, footprint: makeRectFootprint(0, 18, 18, 10), centroid: [0, 18], connectedNodeId: 'N-L1-LOBBY' },
    { id: 'OSM-L1-MED', name: 'Emergency Triage & Pharmacy 101', buildingId: 'BLD-OMEGA', level: 1, minHeight: 0, height: 3.8, category: 'medical_room', widthMeters: 14, depthMeters: 11, footprint: makeRectFootprint(-22, 8, 14, 11), centroid: [-22, 8], connectedNodeId: 'N-L1-WEST' },
    { id: 'OSM-L1-REST', name: 'ADA Patient Restroom 102', buildingId: 'BLD-OMEGA', level: 1, minHeight: 0, height: 3.8, category: 'accessible_restroom', widthMeters: 14, depthMeters: 11, footprint: makeRectFootprint(22, 8, 14, 11), centroid: [22, 8], connectedNodeId: 'N-L1-RESTROOM' },
    { id: 'OSM-L2-CONF302', name: 'MRI & Radiology Suite 302', buildingId: 'BLD-OMEGA', level: 2, minHeight: 4.5, height: 3.8, category: 'medical_room', widthMeters: 16, depthMeters: 11, footprint: makeRectFootprint(-20, 10, 16, 11), centroid: [-20, 10], connectedNodeId: 'N-L2-CONF-302' },
    { id: 'OSM-L2-LH204', name: 'Surgical Recovery Ward 204', buildingId: 'BLD-OMEGA', level: 2, minHeight: 4.5, height: 3.8, category: 'medical_room', widthMeters: 16, depthMeters: 11, footprint: makeRectFootprint(20, 10, 16, 11), centroid: [20, 10], connectedNodeId: 'N-L2-EAST' },
    { id: 'OSM-L2-CAFE', name: 'Doctor & Visitor Dining Hall', buildingId: 'BLD-OMEGA', level: 2, minHeight: 4.5, height: 3.8, category: 'cafeteria', widthMeters: 22, depthMeters: 10, footprint: makeRectFootprint(0, 20, 22, 10), centroid: [0, 20], connectedNodeId: 'N-L2-CAFE' }
  ]
};

// ============================================================================
// 3. OSM GEOJSON IMPORTER & EXPORTER
// ============================================================================
function exportPackageAsOSMGeoJSON(pkg: CampusOSMMapPackage): string {
  const nodeMap = new Map<string, GraphNode>();
  pkg.nodes.forEach((n) => nodeMap.set(n.id, n));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geoFeatures: any[] = [];

  pkg.features.forEach((feat) => {
    const closedRing = [...feat.footprint, feat.footprint[0]];
    geoFeatures.push({
      type: 'Feature',
      id: feat.id,
      properties: {
        id: feat.id,
        name: feat.name,
        buildingId: feat.buildingId,
        indoor: feat.category === 'corridor' ? 'corridor' : 'room',
        level: String(feat.level),
        height: String(feat.height),
        min_height: String(feat.minHeight),
        category: feat.category,
        wheelchair: 'yes',
        connectedNodeId: feat.connectedNodeId
      },
      geometry: {
        type: 'Polygon',
        coordinates: [closedRing]
      }
    });
  });

  pkg.edges.forEach((edge) => {
    const n1 = nodeMap.get(edge.fromNodeId);
    const n2 = nodeMap.get(edge.toNodeId);
    if (!n1 || !n2) return;
    geoFeatures.push({
      type: 'Feature',
      id: edge.id,
      properties: {
        id: edge.id,
        indoor: 'highway',
        highway: edge.attributes.isStairs
          ? 'steps'
          : edge.attributes.isElevator
          ? 'elevator'
          : 'footway',
        wheelchair: edge.attributes.isStairs ? 'no' : 'yes',
        level: String(n1.level),
        status: edge.status,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        distanceMeters: edge.distanceMeters
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [n1.x, n1.z],
          [n2.x, n2.z]
        ]
      }
    });
  });

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: pkg.mapName,
      buildingId: pkg.buildingId,
      updatedAt: pkg.updatedAt,
      osmPackageBackup: pkg,
      features: geoFeatures
    },
    null,
    2
  );
}

function normalizeLoadedPackage(pkg: Partial<CampusOSMMapPackage>, fallbackName = 'Custom OSM Map'): CampusOSMMapPackage {
  const features = Array.isArray(pkg.features) ? pkg.features : DEFAULT_ACADEMIC_OSM_PACKAGE.features;
  const nodes = Array.isArray(pkg.nodes) ? pkg.nodes : DEFAULT_ACADEMIC_OSM_PACKAGE.nodes;
  const edges = Array.isArray(pkg.edges) ? pkg.edges : DEFAULT_ACADEMIC_OSM_PACKAGE.edges;
  const anchors = Array.isArray(pkg.anchors) ? pkg.anchors : DEFAULT_ACADEMIC_OSM_PACKAGE.anchors;

  const detectedLevels = new Set<number>(Array.isArray(pkg.levels) ? pkg.levels : [1, 2]);
  nodes.forEach((n) => detectedLevels.add(n.level));
  features.forEach((f) => detectedLevels.add(f.level));
  const sortedLevels = Array.from(detectedLevels).sort((a, b) => a - b);

  return {
    mapName: pkg.mapName || fallbackName,
    buildingId: pkg.buildingId || 'BLD-CUSTOM',
    updatedAt: new Date().toLocaleTimeString(),
    levels: sortedLevels.length > 0 ? sortedLevels : [1, 2],
    canvasBounds: pkg.canvasBounds || { widthMeters: 76, depthMeters: 56 },
    features,
    nodes,
    edges,
    anchors
  };
}

function parseUploadedOSMFile(rawText: string, fileName: string): CampusOSMMapPackage {
  const parsed = JSON.parse(rawText);

  if (parsed?.osmPackageBackup?.features && parsed?.osmPackageBackup?.nodes) {
    return normalizeLoadedPackage(parsed.osmPackageBackup, fileName);
  }

  if (parsed && Array.isArray(parsed.features) && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
    return normalizeLoadedPackage(parsed, fileName);
  }

  if (parsed && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    const newFeatures: OSMIndoorFeature[] = [];
    const newNodes: GraphNode[] = [];
    const newEdges: GraphEdge[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsed.features.forEach((geoFeat: any, idx: number) => {
      if (geoFeat.geometry?.type !== 'Polygon') return;
      const props = geoFeat.properties || {};
      const name = props.name || props['addr:door'] || `OSM Room ${idx + 1}`;
      const level = Number(props.level ?? 1) || 1;
      const category = String(props.category || props.indoor || 'office');

      const ring: number[][] = geoFeat.geometry.coordinates[0] || [];
      const footprint: [number, number][] = ring
        .slice(0, Math.max(3, ring.length - 1))
        .map((pt: number[]) => [Number(pt[0]), Number(pt[1])] as [number, number]);

      if (footprint.length < 3) return;

      const cx = Number((footprint.reduce((s, p) => s + p[0], 0) / footprint.length).toFixed(1));
      const cz = Number((footprint.reduce((s, p) => s + p[1], 0) / footprint.length).toFixed(1));
      const minHeight = (level - 1) * 4.5;
      const nodeId = props.connectedNodeId || `N-OSM-CUSTOM-${idx + 1}`;

      if (!newNodes.some((n) => n.id === nodeId)) {
        newNodes.push({
          id: nodeId,
          label: name,
          buildingId: 'BLD-OSM',
          level,
          x: cx,
          y: minHeight,
          z: cz,
          category,
          verticalTransit: 'none',
          lifeSafety: 'none'
        });
      }

      newFeatures.push({
        id: props.id || `OSM-FEAT-${idx + 1}`,
        name,
        buildingId: 'BLD-OSM',
        level,
        minHeight,
        height: Number(props.height ?? 3.8),
        category,
        footprint,
        centroid: [cx, cz],
        connectedNodeId: nodeId
      });
    });

    return normalizeLoadedPackage(
      {
        mapName: parsed.name || `Custom OSM GeoJSON (${fileName})`,
        buildingId: 'BLD-OSM',
        features: newFeatures,
        nodes: newNodes,
        edges: newEdges,
        anchors: DEFAULT_ACADEMIC_OSM_PACKAGE.anchors
      },
      fileName
    );
  }

  throw new Error('Unrecognized file structure. Upload a valid OSM GeoJSON FeatureCollection or CampusOSMMapPackage JSON.');
}

// ============================================================================
// 4. MULTI-PROFILE A* & DISABILITY STAIR-FREE ROUTING ENGINE
// ============================================================================
function evaluateEdgeWeight(edge: GraphEdge, profile: RoutingProfile, isEvacuation: boolean): number {
  if (edge.status !== 'ACTIVE') return Infinity;
  const attr = edge.attributes;

  if (isEvacuation || profile === 'EMERGENCY_EVACUATION') {
    if (attr.isElevator || attr.verticalTransitType === 'elevator' || attr.verticalTransitType === 'service_lift') {
      return Infinity;
    }
  }

  if (profile === 'WHEELCHAIR_ADA') {
    if (attr.isStairs || attr.verticalTransitType === 'stairs' || attr.isTurnstile || attr.isEscalator) {
      return Infinity;
    }
    if (attr.isRamp && attr.rampInclinePercent > 8.33) {
      return Infinity;
    }
    if (attr.doorClearanceCm < 81.5 || attr.corridorWidthCm < 91.5) {
      return Infinity;
    }
    if (attr.isElevator || attr.isRamp) {
      return edge.distanceMeters * 0.85;
    }
  }

  if (profile === 'VISUALLY_IMPAIRED') {
    let mult = attr.hasTactilePaving ? 0.6 : 1.0;
    if (attr.isOpenAtrium) mult *= 2.2;
    return edge.distanceMeters * mult;
  }

  return edge.distanceMeters;
}

function buildRouteObject(
  endNodeId: string,
  cameFrom: Map<string, { prevNodeId: string; edge: GraphEdge }>,
  nodeMap: Map<string, GraphNode>,
  profile: RoutingProfile,
  isEvac: boolean
): ComputedRoute {
  const pathNodes: GraphNode[] = [];
  const pathEdges: GraphEdge[] = [];
  let curr: string | undefined = endNodeId;

  while (curr) {
    pathNodes.unshift(nodeMap.get(curr)!);
    const step = cameFrom.get(curr);
    if (step) {
      pathEdges.unshift(step.edge);
      curr = step.prevNodeId;
    } else {
      curr = undefined;
    }
  }

  const stairsUsedCount = pathEdges.filter(
    (e) => e.attributes.isStairs || e.attributes.verticalTransitType === 'stairs'
  ).length;

  const accessibleTransitUsed = pathEdges
    .filter((e) => e.attributes.isElevator || e.attributes.isRamp)
    .map((e) => (e.attributes.isElevator ? 'Wheelchair Passenger Elevator' : 'ADA Compliant Ramp (7.5% Slope)'));

  const totalDistanceMeters = Math.round(pathEdges.reduce((s, e) => s + e.distanceMeters, 0));
  const prefix = isEvac
    ? 'Emergency Evacuation: '
    : profile === 'WHEELCHAIR_ADA'
    ? 'Stair-Free Route: '
    : '';

  const instructions: RouteInstruction[] = pathNodes.map((n, i) => {
    if (i === pathNodes.length - 1) {
      return {
        stepIndex: i,
        nodeId: n.id,
        level: n.level,
        distanceMeters: 0,
        turnDirection: 'ARRIVE',
        textDirective: `${prefix}You have arrived at ${n.label} on Floor Level ${n.level}.`,
        hapticPattern: [300, 100, 300, 100, 500]
      };
    }
    const next = pathNodes[i + 1];
    const edge = pathEdges[i];
    if (next.level !== n.level) {
      return {
        stepIndex: i,
        nodeId: n.id,
        level: n.level,
        distanceMeters: edge.distanceMeters,
        turnDirection: next.level > n.level ? 'LEVEL_UP' : 'LEVEL_DOWN',
        textDirective: `${prefix}Take the ${edge.attributes.verticalTransitType} at ${n.label} to Floor Level ${next.level}.`,
        hapticPattern: [400, 150, 400]
      };
    }
    return {
      stepIndex: i,
      nodeId: n.id,
      level: n.level,
      distanceMeters: edge.distanceMeters,
      turnDirection: 'STRAIGHT',
      textDirective: `${prefix}Proceed ${edge.distanceMeters} meters toward ${next.label}.`,
      hapticPattern: [150]
    };
  });

  return {
    profile,
    isEmergencyEvacuation: isEvac,
    stairsUsedCount,
    accessibleTransitUsed,
    totalDistanceMeters,
    estimatedSeconds: Math.round(totalDistanceMeters / 1.25),
    pathNodes,
    pathEdges,
    instructions
  };
}

function computePath(
  startNodeId: string,
  targetNodeId: string,
  profile: RoutingProfile,
  nodes: GraphNode[],
  edges: GraphEdge[],
  isEvac: boolean
): ComputedRoute | null {
  const nodeMap = new Map<string, GraphNode>();
  nodes.forEach((n) => nodeMap.set(n.id, n));
  if (!nodeMap.has(startNodeId)) return null;

  const dist = new Map<string, number>();
  const cameFrom = new Map<string, { prevNodeId: string; edge: GraphEdge }>();
  const unvisited = new Set<string>();

  nodes.forEach((n) => {
    dist.set(n.id, Infinity);
    unvisited.add(n.id);
  });
  dist.set(startNodeId, 0);

  const safeExitIds = new Set<string>(
    nodes
      .filter((n) => n.level === 1 && (n.lifeSafety === 'emergency_exit' || n.lifeSafety === 'muster_point'))
      .map((n) => n.id)
  );

  while (unvisited.size > 0) {
    let currId = '';
    let minD = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity;
      if (d < minD) {
        minD = d;
        currId = id;
      }
    }
    if (!currId || minD === Infinity) break;
    unvisited.delete(currId);

    if (isEvac && safeExitIds.has(currId)) {
      return buildRouteObject(currId, cameFrom, nodeMap, profile, true);
    }
    if (!isEvac && currId === targetNodeId) {
      return buildRouteObject(currId, cameFrom, nodeMap, profile, false);
    }

    const adj = edges.filter((e) => e.fromNodeId === currId || e.toNodeId === currId);
    for (const edge of adj) {
      const neighborId = edge.fromNodeId === currId ? edge.toNodeId : edge.fromNodeId;
      if (!unvisited.has(neighborId)) continue;
      const w = evaluateEdgeWeight(edge, profile, isEvac);
      if (w === Infinity) continue;
      const alt = minD + w;
      if (alt < (dist.get(neighborId) ?? Infinity)) {
        dist.set(neighborId, alt);
        cameFrom.set(neighborId, { prevNodeId: currId, edge });
      }
    }
  }
  return null;
}

// ============================================================================
// 5. REAL ISO/IEC 18004 REED-SOLOMON QR CODE ENCODER (SCANNABLE BY ANY CAMERA)
// ============================================================================
function computeISOQRMatrix(payloadText: string): boolean[][] {
  const cleanBytes: number[] = [];
  const text = payloadText.slice(0, 17);
  for (let i = 0; i < text.length; i++) {
    cleanBytes.push(text.charCodeAt(i) & 0xff);
  }

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(cleanBytes.length, 8);
  cleanBytes.forEach((b) => pushBits(b, 8));
  pushBits(0, Math.min(4, 152 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] || 0);
    dataCodewords.push(byte);
  }

  let padToggle = true;
  while (dataCodewords.length < 19) {
    dataCodewords.push(padToggle ? 0xec : 0x11);
    padToggle = !padToggle;
  }

  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let v = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = v;
    gfLog[v] = i;
    v <<= 1;
    if (v & 0x100) v ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
  const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : gfExp[gfLog[a] + gfLog[b]]);

  let gen = [1];
  for (let i = 0; i < 7; i++) {
    const nextGen = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      nextGen[j] ^= gen[j];
      nextGen[j + 1] ^= gfMul(gen[j], gfExp[i]);
    }
    gen = nextGen;
  }

  const ec = new Array(7).fill(0);
  for (const b of dataCodewords) {
    const factor = b ^ ec[0];
    ec.shift();
    ec.push(0);
    for (let j = 0; j < 7; j++) {
      ec[j] ^= gfMul(gen[j + 1], factor);
    }
  }

  const allCodewords = [...dataCodewords, ...ec];
  const allBits: number[] = [];
  allCodewords.forEach((cw) => {
    for (let i = 7; i >= 0; i--) allBits.push((cw >>> i) & 1);
  });

  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isReserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = dark;
      isReserved[r][c] = true;
    }
  };

  const placeFinderPattern = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFunctionModule(rr, cc, inOuter || inInner);
      }
    }
  };

  placeFinderPattern(0, 0);
  placeFinderPattern(0, size - 7);
  placeFinderPattern(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  setFunctionModule(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!isReserved[8][i]) isReserved[8][i] = true;
    if (!isReserved[i][8]) isReserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    isReserved[8][size - 1 - i] = true;
    isReserved[size - 1 - i][8] = true;
  }

  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let cOffset = 0; cOffset < 2; cOffset++) {
        const c = rightCol - cOffset;
        if (!isReserved[r][c]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] === 1 : false;
          const maskInvert = (r + c) % 2 === 0;
          matrix[r][c] = bit !== maskInvert;
        }
      }
    }
    upward = !upward;
  }

  const fmtData = 0b01000;
  let rem = fmtData << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  const formatBits = ((fmtData << 10) | rem) ^ 0x5412;
  const getFmtBit = (idx: number) => ((formatBits >>> idx) & 1) === 1;

  const tlRows = [0, 1, 2, 3, 4, 5, 7, 8];
  tlRows.forEach((r, idx) => (matrix[r][8] = getFmtBit(idx)));
  const tlCols = [7, 5, 4, 3, 2, 1, 0];
  tlCols.forEach((c, idx) => (matrix[8][c] = getFmtBit(idx + 8)));

  for (let i = 0; i < 8; i++) {
    matrix[8][size - 1 - i] = getFmtBit(i);
  }
  for (let i = 0; i < 7; i++) {
    matrix[size - 7 + i][8] = getFmtBit(i + 8);
  }

  return matrix;
}

function downloadQRBadgeAsSVG(anchor: QRLandmarkAnchor) {
  const matrix = computeISOQRMatrix(anchor.shortCode);
  const cellSize = 7;
  const qrOffset = 76;
  let rects = '';
  matrix.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val) {
        rects += `<rect x="${qrOffset + c * cellSize}" y="${70 + r * cellSize}" width="${cellSize}" height="${cellSize}" fill="#000000" />`;
      }
    });
  });

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="370" viewBox="0 0 300 370">
  <desc>SHORTCODE:${anchor.shortCode}</desc>
  <rect x="4" y="4" width="292" height="362" rx="14" fill="#ffffff" stroke="#0284c7" stroke-width="6"/>
  <rect x="18" y="18" width="264" height="28" rx="6" fill="#0f172a"/>
  <text x="150" y="36" font-family="sans-serif" font-size="11" font-weight="bold" fill="#38bdf8" text-anchor="middle">
    ${anchor.buildingId} • FLOOR LEVEL ${anchor.level} • HDG ${anchor.headingDeg}°
  </text>
  <rect x="48" y="46" width="204" height="196" rx="8" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
  ${rects}
  <text x="150" y="262" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a" text-anchor="middle">
    ${anchor.label}
  </text>
  <rect x="24" y="276" width="252" height="56" rx="8" fill="#fef08a" stroke="#ca8a04" stroke-width="2" stroke-dasharray="6,4"/>
  <text x="150" y="294" font-family="sans-serif" font-size="10" font-weight="bold" fill="#854d0e" text-anchor="middle">
    DAMAGED QR FAILOVER SHORT CODE
  </text>
  <text x="150" y="320" font-family="monospace" font-size="22" font-weight="bold" fill="#0f172a" text-anchor="middle">
    ${anchor.shortCode}
  </text>
  <text x="150" y="352" font-family="monospace" font-size="10" fill="#475569" text-anchor="middle">
    WGS84: ${anchor.coordinates.lat.toFixed(4)}, ${anchor.coordinates.lon.toFixed(4)}
  </text>
</svg>`;

  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `QR-Badge-${anchor.shortCode}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadQRBadgeAsPNG(anchor: QRLandmarkAnchor) {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 740;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 600, 740);
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 12;
  ctx.strokeRect(10, 10, 580, 720);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(36, 36, 528, 56);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${anchor.buildingId} • FLOOR LEVEL ${anchor.level} • HDG ${anchor.headingDeg}°`, 300, 72);

  const matrix = computeISOQRMatrix(anchor.shortCode);
  const cellSize = 14;
  const startX = 153;
  const startY = 140;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(startX - 42, startY - 42, 21 * cellSize + 84, 21 * cellSize + 84);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.strokeRect(startX - 42, startY - 42, 21 * cellSize + 84, 21 * cellSize + 84);

  ctx.fillStyle = '#000000';
  matrix.forEach((row, r) => {
    row.forEach((val, c) => {
      if (val) {
        ctx.fillRect(startX + c * cellSize, startY + r * cellSize, cellSize, cellSize);
      }
    });
  });

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(anchor.label, 300, 520);

  ctx.fillStyle = '#fef08a';
  ctx.fillRect(48, 550, 504, 112);
  ctx.strokeStyle = '#ca8a04';
  ctx.lineWidth = 4;
  ctx.strokeRect(48, 550, 504, 112);

  ctx.fillStyle = '#854d0e';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('DAMAGED QR FAILOVER SHORT CODE', 300, 586);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 44px monospace';
  ctx.fillText(anchor.shortCode, 300, 642);

  ctx.fillStyle = '#475569';
  ctx.font = '20px monospace';
  ctx.fillText(`WGS84: ${anchor.coordinates.lat.toFixed(4)}, ${anchor.coordinates.lon.toFixed(4)}`, 300, 702);

  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `QR-Badge-${anchor.shortCode}.png`;
  a.click();
}

const QRCodeSVG: React.FC<{ shortCode: string; size?: number }> = ({ shortCode, size = 156 }) => {
  const gridSize = 21;
  const quietZone = 4;
  const totalView = gridSize + quietZone * 2;
  const cells = useMemo(() => computeISOQRMatrix(shortCode), [shortCode]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${totalView} ${totalView}`}
      shapeRendering="crispEdges"
      style={{ background: '#ffffff', borderRadius: '8px', border: '2px solid #0f172a' }}
    >
      <rect x={0} y={0} width={totalView} height={totalView} fill="#ffffff" />
      {cells.map((row, rIdx) =>
        row.map((val, cIdx) =>
          val ? (
            <rect
              key={`${rIdx}-${cIdx}`}
              x={cIdx + quietZone}
              y={rIdx + quietZone}
              width={1}
              height={1}
              fill="#000000"
            />
          ) : null
        )
      )}
    </svg>
  );
};

// ============================================================================
// 6. FULL-CONTROL ADMIN FLOORPLAN STUDIO (100% MANUAL CORRIDOR CONNECTION)
// ============================================================================
type StudioTool =
  | 'SELECT_DRAG_EDIT'
  | 'DROP_RECT_ROOM'
  | 'DRAW_POLYGON_ROOM'
  | 'MANUAL_CONNECT_CORRIDOR'
  | 'PLACE_CORRIDOR_POINT'
  | 'DROP_TRANSIT'
  | 'PLACE_QR';

const AdminFloorplanStudio: React.FC<{
  osmPackage: CampusOSMMapPackage;
  onUpdatePackage: (nextPkg: CampusOSMMapPackage, msg: string) => void;
  onExportGeoJSON: () => void;
}> = ({ osmPackage, onUpdatePackage, onExportGeoJSON }) => {
  const [drawLevel, setDrawLevel] = useState<number>(osmPackage.levels[0] || 1);
  const [toolMode, setToolMode] = useState<StudioTool>('SELECT_DRAG_EDIT');
  const [canvasZoom, setCanvasZoom] = useState<number>(() =>
  typeof window !== 'undefined' && window.innerWidth < 900 ? 0.55 : 1.0
);

  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [dragState, setDragState] = useState<{
    type: 'ROOM' | 'ROOM_RESIZE' | 'NODE' | 'QR';
    id: string;
    startX: number;
    startZ: number;
  } | null>(null);

  const [newRoomName, setNewRoomName] = useState<string>('Robotics & AI Lab 210');
  const [newRoomType, setNewRoomType] = useState<string>('robotics_lab');
  const [newRoomWidth, setNewRoomWidth] = useState<number>(14);
  const [newRoomDepth, setNewRoomDepth] = useState<number>(10);
  const [newRoomHeight, setNewRoomHeight] = useState<number>(3.8);
  const [draftPolygonPoints, setDraftPolygonPoints] = useState<[number, number][]>([]);

  const [corridorStartNodeId, setCorridorStartNodeId] = useState<string | null>(null);
  const [cursorMeters, setCursorMeters] = useState<[number, number] | null>(null);
  const [transitTypeToDrop, setTransitTypeToDrop] = useState<'stairs' | 'ramp' | 'elevator'>('elevator');
  const [autoLinkVerticalShaftOnly, setAutoLinkVerticalShaftOnly] = useState<boolean>(true);
  const [newQrLabel, setNewQrLabel] = useState<string>('Corridor Intersection Checkpoint');

  const [statusNote, setStatusNote] = useState<string>(
    'Corridors never connect automatically. Use Tool 3 to manually click Start Point → End Point to draw or connect any corridor.'
  );

  const boundsW = osmPackage.canvasBounds?.widthMeters || 76;
  const boundsD = osmPackage.canvasBounds?.depthMeters || 56;
  const svgW = Math.round(boundsW * 11 * canvasZoom);
  const svgH = Math.round(boundsD * 11 * canvasZoom);

  const meterToPx = (x: number, z: number): [number, number] => {
    const px = ((x + boundsW / 2) / boundsW) * svgW;
    const py = ((z + boundsD / 2) / boundsD) * svgH;
    return [Number(px.toFixed(1)), Number(py.toFixed(1))];
  };

  const pxToMeter = (px: number, py: number): [number, number] => {
    const x = Number(((px / svgW) * boundsW - boundsW / 2).toFixed(1));
    const z = Number(((py / svgH) * boundsD - boundsD / 2).toFixed(1));
    return [x, z];
  };

  const getMouseMeters = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * svgW;
    const py = ((e.clientY - rect.top) / rect.height) * svgH;
    return pxToMeter(px, py);
  };

  const levelFeatures = osmPackage.features.filter((f) => f.level === drawLevel);
  const levelNodes = osmPackage.nodes.filter((n) => n.level === drawLevel);
  const levelAnchors = osmPackage.anchors.filter((a) => a.level === drawLevel);

  const selectedFeature = osmPackage.features.find((f) => f.id === selectedFeatureId) || null;
  const selectedNode = osmPackage.nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = osmPackage.edges.find((e) => e.id === selectedEdgeId) || null;
  const activeStartNode = osmPackage.nodes.find((n) => n.id === corridorStartNodeId) || null;

  const getFeatureDimensions = (feat: OSMIndoorFeature): { w: number; d: number } => {
    if (feat.widthMeters && feat.depthMeters) {
      return { w: feat.widthMeters, d: feat.depthMeters };
    }
    const xs = feat.footprint.map((p) => p[0]);
    const zs = feat.footprint.map((p) => p[1]);
    const w = Math.max(4, Number((Math.max(...xs) - Math.min(...xs)).toFixed(1)));
    const d = Math.max(4, Number((Math.max(...zs) - Math.min(...zs)).toFixed(1)));
    return { w, d };
  };

  const handleAddFloorLevel = () => {
    const maxLvl = Math.max(...osmPackage.levels, 1);
    const nextLvl = maxLvl + 1;
    const nextPkg: CampusOSMMapPackage = {
      ...osmPackage,
      updatedAt: new Date().toLocaleTimeString(),
      levels: [...osmPackage.levels, nextLvl]
    };
    setDrawLevel(nextLvl);
    setCorridorStartNodeId(null);
    onUpdatePackage(
      nextPkg,
      `Added blank Floor Level ${nextLvl}. Place rooms, corridor points, and stairs/elevators wherever you want.`
    );
  };

  const handleDeleteCurrentFloor = () => {
    if (osmPackage.levels.length <= 1) {
      setStatusNote('Cannot delete the only remaining floor.');
      return;
    }
    const remainingLevels = osmPackage.levels.filter((l) => l !== drawLevel);
    const removedNodeIds = new Set(
      osmPackage.nodes.filter((n) => n.level === drawLevel).map((n) => n.id)
    );

    const nextPkg: CampusOSMMapPackage = {
      ...osmPackage,
      updatedAt: new Date().toLocaleTimeString(),
      levels: remainingLevels,
      features: osmPackage.features.filter((f) => f.level !== drawLevel),
      nodes: osmPackage.nodes.filter((n) => n.level !== drawLevel),
      edges: osmPackage.edges.filter(
        (e) => !removedNodeIds.has(e.fromNodeId) && !removedNodeIds.has(e.toNodeId)
      ),
      anchors: osmPackage.anchors.filter((a) => a.level !== drawLevel)
    };

    setDrawLevel(remainingLevels[0]);
    onUpdatePackage(nextPkg, `Removed Floor Level ${drawLevel}.`);
  };

  const handleClearFloorCorridors = () => {
    const floorNodeIds = new Set(levelNodes.map((n) => n.id));
    const nextEdges = osmPackage.edges.filter(
      (e) => !(floorNodeIds.has(e.fromNodeId) && floorNodeIds.has(e.toNodeId))
    );
    setCorridorStartNodeId(null);
    setSelectedEdgeId(null);
    onUpdatePackage(
      {
        ...osmPackage,
        updatedAt: new Date().toLocaleTimeString(),
        edges: nextEdges
      },
      `Cleared all horizontal corridor connections on Floor Level ${drawLevel}. You can now connect them manually!`
    );
  };

  const handleExpandCanvasBounds = (addW: number, addD: number) => {
    const nextW = Math.max(40, boundsW + addW);
    const nextD = Math.max(40, boundsD + addD);
    const nextPkg: CampusOSMMapPackage = {
      ...osmPackage,
      updatedAt: new Date().toLocaleTimeString(),
      canvasBounds: { widthMeters: nextW, depthMeters: nextD }
    };
    onUpdatePackage(nextPkg, `Expanded OSM floorplan area to ${nextW}m × ${nextD}m.`);
  };

  const updateSelectedRoomProperties = (updates: {
    name?: string;
    category?: string;
    widthMeters?: number;
    depthMeters?: number;
    height?: number;
  }) => {
    if (!selectedFeature) return;
    const curDims = getFeatureDimensions(selectedFeature);
    const nextW = updates.widthMeters !== undefined ? Math.max(3, updates.widthMeters) : curDims.w;
    const nextD = updates.depthMeters !== undefined ? Math.max(3, updates.depthMeters) : curDims.d;
    const nextName = updates.name !== undefined ? updates.name : selectedFeature.name;
    const nextCat = updates.category !== undefined ? updates.category : selectedFeature.category;
    const nextH = updates.height !== undefined ? Math.max(2, updates.height) : selectedFeature.height;

    const [cx, cz] = selectedFeature.centroid;
    const updatedFootprint =
      updates.widthMeters !== undefined || updates.depthMeters !== undefined
        ? makeRectFootprint(cx, cz, nextW, nextD)
        : selectedFeature.footprint;

    const nextFeatures = osmPackage.features.map((f) =>
      f.id === selectedFeature.id
        ? {
            ...f,
            name: nextName,
            category: nextCat,
            height: nextH,
            widthMeters: nextW,
            depthMeters: nextD,
            footprint: updatedFootprint
          }
        : f
    );

    const nextNodes = osmPackage.nodes.map((n) =>
      n.id === selectedFeature.connectedNodeId
        ? { ...n, label: nextName, category: nextCat }
        : n
    );

    onUpdatePackage(
      {
        ...osmPackage,
        updatedAt: new Date().toLocaleTimeString(),
        features: nextFeatures,
        nodes: nextNodes
      },
      `Updated room "${nextName}" (${nextW}m × ${nextD}m, type: ${nextCat}).`
    );
  };

  const handleDeleteSelectedEntity = () => {
    if (selectedEdge) {
      const nextPkg: CampusOSMMapPackage = {
        ...osmPackage,
        updatedAt: new Date().toLocaleTimeString(),
        edges: osmPackage.edges.filter((e) => e.id !== selectedEdge.id)
      };
      setSelectedEdgeId(null);
      onUpdatePackage(nextPkg, `Deleted corridor connection "${selectedEdge.id}".`);
      return;
    }

    if (selectedFeature) {
      const targetNodeId = selectedFeature.connectedNodeId;
      const nextPkg: CampusOSMMapPackage = {
        ...osmPackage,
        updatedAt: new Date().toLocaleTimeString(),
        features: osmPackage.features.filter((f) => f.id !== selectedFeature.id),
        nodes: osmPackage.nodes.filter((n) => n.id !== targetNodeId),
        edges: osmPackage.edges.filter(
          (e) => e.fromNodeId !== targetNodeId && e.toNodeId !== targetNodeId
        )
      };
      setSelectedFeatureId(null);
      setSelectedNodeId(null);
      onUpdatePackage(nextPkg, `Deleted room "${selectedFeature.name}".`);
      return;
    }

    if (selectedNode) {
      const nextPkg: CampusOSMMapPackage = {
        ...osmPackage,
        updatedAt: new Date().toLocaleTimeString(),
        features: osmPackage.features.filter((f) => f.connectedNodeId !== selectedNode.id),
        nodes: osmPackage.nodes.filter((n) => n.id !== selectedNode.id),
        edges: osmPackage.edges.filter(
          (e) => e.fromNodeId !== selectedNode.id && e.toNodeId !== selectedNode.id
        )
      };
      setSelectedNodeId(null);
      onUpdatePackage(nextPkg, `Deleted node "${selectedNode.label}" and its connected corridors.`);
    }
  };

  const handleCanvasPointerMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const [mx, mz] = getMouseMeters(e);
    setCursorMeters([mx, mz]);

    if (!dragState) return;

    if (dragState.type === 'ROOM') {
      const feat = osmPackage.features.find((f) => f.id === dragState.id);
      if (!feat) return;
      const dx = Number((mx - feat.centroid[0]).toFixed(1));
      const dz = Number((mz - feat.centroid[1]).toFixed(1));
      if (Math.abs(dx) < 0.2 && Math.abs(dz) < 0.2) return;

      const movedFootprint: [number, number][] = feat.footprint.map(([px, pz]) => [
        Number((px + dx).toFixed(1)),
        Number((pz + dz).toFixed(1))
      ]);

      const nextFeatures = osmPackage.features.map((f) =>
        f.id === feat.id
          ? { ...f, centroid: [mx, mz] as [number, number], footprint: movedFootprint }
          : f
      );

      const nextNodes = osmPackage.nodes.map((n) =>
        n.id === feat.connectedNodeId ? { ...n, x: mx, z: mz } : n
      );

      const nodeMap = new Map<string, GraphNode>();
      nextNodes.forEach((n) => nodeMap.set(n.id, n));
      const nextEdges = osmPackage.edges.map((edge) => {
        const n1 = nodeMap.get(edge.fromNodeId);
        const n2 = nodeMap.get(edge.toNodeId);
        if (!n1 || !n2 || n1.level !== n2.level) return edge;
        return {
          ...edge,
          distanceMeters: Math.max(2, Math.round(Math.hypot(n1.x - n2.x, n1.z - n2.z)))
        };
      });

      onUpdatePackage(
        { ...osmPackage, features: nextFeatures, nodes: nextNodes, edges: nextEdges },
        `Moved "${feat.name}" to (${mx}m, ${mz}m).`
      );
    } else if (dragState.type === 'ROOM_RESIZE') {
      const feat = osmPackage.features.find((f) => f.id === dragState.id);
      if (!feat) return;
      const [cx, cz] = feat.centroid;
      const newW = Math.max(4, Number((Math.abs(mx - cx) * 2).toFixed(1)));
      const newD = Math.max(4, Number((Math.abs(mz - cz) * 2).toFixed(1)));
      const resizedFootprint = makeRectFootprint(cx, cz, newW, newD);

      const nextFeatures = osmPackage.features.map((f) =>
        f.id === feat.id
          ? { ...f, widthMeters: newW, depthMeters: newD, footprint: resizedFootprint }
          : f
      );
      onUpdatePackage(
        { ...osmPackage, features: nextFeatures },
        `Resized "${feat.name}" to ${newW}m × ${newD}m.`
      );
    } else if (dragState.type === 'NODE') {
      const nextNodes = osmPackage.nodes.map((n) =>
        n.id === dragState.id ? { ...n, x: mx, z: mz } : n
      );
      const linkedFeat = osmPackage.features.find((f) => f.connectedNodeId === dragState.id);
      let nextFeatures = osmPackage.features;
      if (linkedFeat) {
        const dx = Number((mx - linkedFeat.centroid[0]).toFixed(1));
        const dz = Number((mz - linkedFeat.centroid[1]).toFixed(1));
        nextFeatures = osmPackage.features.map((f) =>
          f.id === linkedFeat.id
            ? {
                ...f,
                centroid: [mx, mz] as [number, number],
                footprint: f.footprint.map(([px, pz]) => [
                  Number((px + dx).toFixed(1)),
                  Number((pz + dz).toFixed(1))
                ])
              }
            : f
        );
      }

      const nodeMap = new Map<string, GraphNode>();
      nextNodes.forEach((n) => nodeMap.set(n.id, n));
      const nextEdges = osmPackage.edges.map((edge) => {
        const n1 = nodeMap.get(edge.fromNodeId);
        const n2 = nodeMap.get(edge.toNodeId);
        if (!n1 || !n2 || n1.level !== n2.level) return edge;
        return {
          ...edge,
          distanceMeters: Math.max(2, Math.round(Math.hypot(n1.x - n2.x, n1.z - n2.z)))
        };
      });

      onUpdatePackage(
        { ...osmPackage, features: nextFeatures, nodes: nextNodes, edges: nextEdges },
        `Repositioned node "${dragState.id}" to (${mx}m, ${mz}m).`
      );
    } else if (dragState.type === 'QR') {
      const nextAnchors = osmPackage.anchors.map((a) =>
        a.landmarkId === dragState.id
          ? {
              ...a,
              coordinates: {
                ...a.coordinates,
                x: mx,
                z: mz,
                lat: Number((12.9716 + mz * 0.00001).toFixed(6)),
                lon: Number((77.5946 + mx * 0.00001).toFixed(6))
              }
            }
          : a
      );
      onUpdatePackage({ ...osmPackage, anchors: nextAnchors }, `Moved QR Anchor to (${mx}m, ${mz}m).`);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragState) return;
    const [mx, mz] = getMouseMeters(e);
    const minHeight = (drawLevel - 1) * 4.5;
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();

    if (toolMode === 'DROP_RECT_ROOM') {
      const nodeId = `N-ROOM-${suffix}`;
      const rName = newRoomName.trim() || `Room ${suffix}`;
      const rType = newRoomType.trim() || 'office';

      const newNode: GraphNode = {
        id: nodeId,
        label: rName,
        buildingId: osmPackage.buildingId,
        level: drawLevel,
        x: mx,
        y: minHeight,
        z: mz,
        category: rType,
        verticalTransit: 'none',
        lifeSafety: 'none'
      };

      const featId = `OSM-ROOM-${suffix}`;
      const newFeat: OSMIndoorFeature = {
        id: featId,
        name: rName,
        buildingId: osmPackage.buildingId,
        level: drawLevel,
        minHeight,
        height: newRoomHeight,
        category: rType,
        widthMeters: newRoomWidth,
        depthMeters: newRoomDepth,
        footprint: makeRectFootprint(mx, mz, newRoomWidth, newRoomDepth),
        centroid: [mx, mz],
        connectedNodeId: nodeId
      };

      setSelectedFeatureId(featId);
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      onUpdatePackage(
        {
          ...osmPackage,
          updatedAt: new Date().toLocaleTimeString(),
          nodes: [...osmPackage.nodes, newNode],
          features: [...osmPackage.features, newFeat]
        },
        `Placed standalone room "${rName}" (${rType}) at (${mx}m, ${mz}m). Use Tool 3 when you want to connect it to a corridor.`
      );
      return;
    }

    if (toolMode === 'DRAW_POLYGON_ROOM') {
      setDraftPolygonPoints((prev) => [...prev, [mx, mz]]);
      setStatusNote(`Placed polygon vertex (${mx}m, ${mz}m). Place at least 3 vertices, then click "Finish Polygon Room".`);
      return;
    }

    if (toolMode === 'MANUAL_CONNECT_CORRIDOR') {
      const newNodeId = `N-CORR-L${drawLevel}-${suffix}`;
      const newCorrNode: GraphNode = {
        id: newNodeId,
        label: `Corridor Point L${drawLevel}-${suffix}`,
        buildingId: osmPackage.buildingId,
        level: drawLevel,
        x: mx,
        y: minHeight,
        z: mz,
        category: 'corridor',
        verticalTransit: 'none',
        lifeSafety: 'none'
      };

      if (!corridorStartNodeId) {
        setCorridorStartNodeId(newNodeId);
        setSelectedNodeId(newNodeId);
        onUpdatePackage(
          {
            ...osmPackage,
            updatedAt: new Date().toLocaleTimeString(),
            nodes: [...osmPackage.nodes, newCorrNode]
          },
          `Step 1: Placed Corridor Start Point at (${mx}m, ${mz}m). Now click an End Point (a Room, Stair, Elevator, or another spot) to connect them!`
        );
        return;
      }

      const startNode = osmPackage.nodes.find((n) => n.id === corridorStartNodeId);
      if (!startNode) {
        setCorridorStartNodeId(null);
        return;
      }

      const dist = Math.max(2, Math.round(Math.hypot(startNode.x - mx, startNode.z - mz)));
      const newEdge: GraphEdge = {
        id: `E-MANUAL-${suffix}`,
        fromNodeId: startNode.id,
        toNodeId: newNodeId,
        distanceMeters: dist,
        status: 'ACTIVE',
        attributes: { ...baseCorridor }
      };

      setCorridorStartNodeId(null);
      setSelectedNodeId(newNodeId);
      onUpdatePackage(
        {
          ...osmPackage,
          updatedAt: new Date().toLocaleTimeString(),
          nodes: [...osmPackage.nodes, newCorrNode],
          edges: [...osmPackage.edges, newEdge]
        },
        `Connected manual corridor (${dist}m) from "${startNode.label}" to new point (${mx}m, ${mz}m). Click a new Start Point whenever you want to add another connection.`
      );
      return;
    }

    if (toolMode === 'PLACE_CORRIDOR_POINT') {
      const newNodeId = `N-CORR-L${drawLevel}-${suffix}`;
      const newCorrNode: GraphNode = {
        id: newNodeId,
        label: `Corridor Junction L${drawLevel}-${suffix}`,
        buildingId: osmPackage.buildingId,
        level: drawLevel,
        x: mx,
        y: minHeight,
        z: mz,
        category: 'corridor',
        verticalTransit: 'none',
        lifeSafety: 'none'
      };
      setSelectedNodeId(newNodeId);
      onUpdatePackage(
        {
          ...osmPackage,
          updatedAt: new Date().toLocaleTimeString(),
          nodes: [...osmPackage.nodes, newCorrNode]
        },
        `Placed standalone Corridor Junction at (${mx}m, ${mz}m) with 0 lines attached.`
      );
      return;
    }

    if (toolMode === 'DROP_TRANSIT') {
      const nextNodes = [...osmPackage.nodes];
      const nextEdges = [...osmPackage.edges];
      const typeLabel =
        transitTypeToDrop === 'elevator'
          ? 'Wheelchair Passenger Elevator'
          : transitTypeToDrop === 'ramp'
          ? 'ADA Wheelchair Ramp'
          : 'Stairwell (Stairs)';

      const targetLevels = autoLinkVerticalShaftOnly ? osmPackage.levels : [drawLevel];
      const createdIdsByLevel: Record<number, string> = {};

      targetLevels.forEach((lvl) => {
        const tNodeId = `N-${transitTypeToDrop.toUpperCase()}-L${lvl}-${suffix}`;
        createdIdsByLevel[lvl] = tNodeId;
        const lvlY = (lvl - 1) * 4.5;

        nextNodes.push({
          id: tNodeId,
          label: `Level ${lvl} ${typeLabel} ${suffix}`,
          buildingId: osmPackage.buildingId,
          level: lvl,
          x: mx,
          y: lvlY,
          z: mz,
          category: 'corridor',
          verticalTransit: transitTypeToDrop,
          lifeSafety: 'none'
        });
      });

      const sortedLvls = [...targetLevels].sort((a, b) => a - b);
      for (let i = 0; i < sortedLvls.length - 1; i++) {
        const l1 = sortedLvls[i];
        const l2 = sortedLvls[i + 1];
        nextEdges.push({
          id: `E-VERT-${transitTypeToDrop.toUpperCase()}-L${l1}L${l2}-${suffix}`,
          fromNodeId: createdIdsByLevel[l1],
          toNodeId: createdIdsByLevel[l2],
          distanceMeters: transitTypeToDrop === 'ramp' ? 22 : 8,
          status: 'ACTIVE',
          attributes: {
            ...baseCorridor,
            isStairs: transitTypeToDrop === 'stairs',
            isRamp: transitTypeToDrop === 'ramp',
            rampInclinePercent: transitTypeToDrop === 'ramp' ? 7.2 : 0,
            isElevator: transitTypeToDrop === 'elevator',
            verticalTransitType: transitTypeToDrop
          }
        });
      }

      onUpdatePackage(
        {
          ...osmPackage,
          updatedAt: new Date().toLocaleTimeString(),
          nodes: nextNodes,
          edges: nextEdges
        },
        `Placed standalone ${typeLabel} at (${mx}m, ${mz}m). Use Tool 3 to manually connect it to your corridor!`
      );
      return;
    }

    if (toolMode === 'PLACE_QR') {
      const codeNum = Math.floor(10 + Math.random() * 89);
      const shortCode = `FL${drawLevel}-Q${codeNum}`;
      let nearest = levelNodes[0] || osmPackage.nodes[0];
      let minD = Infinity;
      for (const n of levelNodes) {
        const d = Math.hypot(n.x - mx, n.z - mz);
        if (d < minD) {
          minD = d;
          nearest = n;
        }
      }
      const newAnchor: QRLandmarkAnchor = {
        landmarkId: `LM-CUSTOM-${shortCode}`,
        shortCode,
        buildingId: osmPackage.buildingId,
        level: drawLevel,
        coordinates: {
          lat: Number((12.9716 + mz * 0.00001).toFixed(6)),
          lon: Number((77.5946 + mx * 0.00001).toFixed(6)),
          x: mx,
          y: minHeight,
          z: mz
        },
        headingDeg: 0,
        label: `${newQrLabel.trim() || 'Checkpoint'} (${shortCode})`,
        connectedNodeId: nearest ? nearest.id : ''
      };
      onUpdatePackage(
        {
          ...osmPackage,
          updatedAt: new Date().toLocaleTimeString(),
          anchors: [...osmPackage.anchors, newAnchor]
        },
        `Placed QR Checkpoint "${shortCode}" at (${mx}m, ${mz}m).`
      );
    }
  };

  const handleFinishPolygonRoom = () => {
    if (draftPolygonPoints.length < 3) {
      setStatusNote('Click at least 3 points on the grid to form a polygon room.');
      return;
    }
    const cx = Number((draftPolygonPoints.reduce((s, p) => s + p[0], 0) / draftPolygonPoints.length).toFixed(1));
    const cz = Number((draftPolygonPoints.reduce((s, p) => s + p[1], 0) / draftPolygonPoints.length).toFixed(1));
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const nodeId = `N-POLY-${suffix}`;
    const minHeight = (drawLevel - 1) * 4.5;
    const rName = newRoomName.trim() || `Polygon Room ${suffix}`;
    const rType = newRoomType.trim() || 'office';

    const newNode: GraphNode = {
      id: nodeId,
      label: rName,
      buildingId: osmPackage.buildingId,
      level: drawLevel,
      x: cx,
      y: minHeight,
      z: cz,
      category: rType,
      verticalTransit: 'none',
      lifeSafety: 'none'
    };

    const featId = `OSM-POLY-${suffix}`;
    const newFeat: OSMIndoorFeature = {
      id: featId,
      name: rName,
      buildingId: osmPackage.buildingId,
      level: drawLevel,
      minHeight,
      height: newRoomHeight,
      category: rType,
      footprint: draftPolygonPoints,
      centroid: [cx, cz],
      connectedNodeId: nodeId
    };

    setDraftPolygonPoints([]);
    setSelectedFeatureId(featId);
    onUpdatePackage(
      {
        ...osmPackage,
        updatedAt: new Date().toLocaleTimeString(),
        nodes: [...osmPackage.nodes, newNode],
        features: [...osmPackage.features, newFeat]
      },
      `Created standalone polygon room "${rName}" (${rType}). Use Tool 3 when you want to connect it to a corridor.`
    );
  };

  const handleNodeClick = (node: GraphNode, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    const matchingFeat = osmPackage.features.find((f) => f.connectedNodeId === node.id);
    setSelectedFeatureId(matchingFeat ? matchingFeat.id : null);

    if (toolMode === 'MANUAL_CONNECT_CORRIDOR') {
      if (!corridorStartNodeId) {
        setCorridorStartNodeId(node.id);
        setStatusNote(
          `Step 1: Selected Start Point "${node.label}". Now click any second node (Room, Corridor, Stair, Elevator) to connect them, or click empty space to extend!`
        );
        return;
      }

      if (corridorStartNodeId === node.id) {
        setCorridorStartNodeId(null);
        setStatusNote('Cancelled start point selection.');
        return;
      }

      const startNode = osmPackage.nodes.find((n) => n.id === corridorStartNodeId);
      if (!startNode) {
        setCorridorStartNodeId(null);
        return;
      }

      const alreadyExists = osmPackage.edges.some(
        (e) =>
          (e.fromNodeId === startNode.id && e.toNodeId === node.id) ||
          (e.fromNodeId === node.id && e.toNodeId === startNode.id)
      );
      if (alreadyExists) {
        setCorridorStartNodeId(null);
        setStatusNote(`"${startNode.label}" and "${node.label}" are already connected.`);
        return;
      }

      const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const dist = Math.max(2, Math.round(Math.hypot(startNode.x - node.x, startNode.z - node.z)));
      const newEdge: GraphEdge = {
        id: `E-MANUAL-${suffix}`,
        fromNodeId: startNode.id,
        toNodeId: node.id,
        distanceMeters: dist,
        status: 'ACTIVE',
        attributes: { ...baseCorridor }
      };

      setCorridorStartNodeId(null);
      onUpdatePackage(
        {
          ...osmPackage,
          updatedAt: new Date().toLocaleTimeString(),
          edges: [...osmPackage.edges, newEdge]
        },
        `Manually connected "${startNode.label}" ↔ "${node.label}" (${dist}m). Selection cleared—pick a new Start Point when ready!`
      );
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#0f172a' }}>
      {/* Left Full-Control OSM Studio Sidebar */}
      <aside
        style={{
          width: '395px',
          background: '#0f172a',
          borderRight: '1px solid #334155',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          overflowY: 'auto'
        }}
      >
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 800, color: '#38bdf8' }}>
            100% MANUAL OSM FLOORPLAN STUDIO
          </h2>
          <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            Rooms, stairs, and elevators never auto-connect. You control every corridor connection manually.
          </p>
        </div>

        {/* 1. Multi-Floor Manager */}
        <div style={{ background: '#1e293b', padding: '10px', borderRadius: '10px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#cbd5e1' }}>
              BUILDING FLOORS ({osmPackage.levels.length} LEVELS)
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={handleAddFloorLevel}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#10b981',
                  color: '#052e16',
                  fontWeight: 800,
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
              >
                <Plus size={12} />
                Add Blank Floor
              </button>
              {osmPackage.levels.length > 1 && (
                <button
                  onClick={handleDeleteCurrentFloor}
                  style={{
                    padding: '4px 7px',
                    borderRadius: '6px',
                    border: '1px solid #ef4444',
                    background: '#0f172a',
                    color: '#f87171',
                    fontWeight: 700,
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  Delete L{drawLevel}
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {osmPackage.levels.map((lvl) => (
              <button
                key={lvl}
                onClick={() => {
                  setDrawLevel(lvl);
                  setDraftPolygonPoints([]);
                  setCorridorStartNodeId(null);
                  setSelectedEdgeId(null);
                }}
                style={{
                  flex: 1,
                  minWidth: '70px',
                  padding: '7px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  background: drawLevel === lvl ? '#0284c7' : '#0f172a',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Floor L{lvl}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Tool Mode Palette */}
        <div style={{ background: '#1e293b', padding: '10px', borderRadius: '10px', border: '1px solid #334155', display: 'grid', gap: '5px' }}>
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#cbd5e1', marginBottom: '2px' }}>
            STUDIO TOOLS (100% MANUAL CONTROL):
          </div>
          {[
            { id: 'SELECT_DRAG_EDIT', label: '1. Select / Drag-and-Drop / Edit Room or Corridor' },
            { id: 'DROP_RECT_ROOM', label: '2. Drop Standalone Room (No Auto-Corridor)' },
            { id: 'DRAW_POLYGON_ROOM', label: '2B. Draw Standalone Polygon Room' },
            { id: 'MANUAL_CONNECT_CORRIDOR', label: '3. Manual Connect / Extend Corridor (Start → End)' },
            { id: 'PLACE_CORRIDOR_POINT', label: '3B. Drop Standalone Corridor Point (No Line)' },
            { id: 'DROP_TRANSIT', label: '4. Drop Standalone Stairs / ADA Ramp / Elevator' },
            { id: 'PLACE_QR', label: '5. Drop Physical QR & Short-Code Badge' }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setToolMode(t.id as StudioTool);
                setCorridorStartNodeId(null);
                setDraftPolygonPoints([]);
              }}
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                border: 'none',
                background: toolMode === t.id ? '#7c3aed' : '#0f172a',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '11.5px',
                textAlign: 'left',
                cursor: 'pointer'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 3. POST-CREATION ROOM, NODE & CORRIDOR EDGE INSPECTOR */}
        {(selectedFeature || selectedNode || selectedEdge) && (
          <div style={{ background: '#1e293b', padding: '12px', borderRadius: '10px', border: '2px solid #38bdf8', display: 'grid', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8' }}>
                {selectedEdge
                  ? `SELECTED CORRIDOR LINE (${selectedEdge.distanceMeters}m)`
                  : 'SELECTED ITEM INSPECTOR (LIVE EDIT)'}
              </span>
              <button
                onClick={handleDeleteSelectedEntity}
                style={{
                  padding: '4px 9px',
                  borderRadius: '5px',
                  border: 'none',
                  background: '#dc2626',
                  color: '#ffffff',
                  fontSize: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
              >
                <Trash2 size={11} />
                {selectedEdge ? 'Delete Corridor Line' : 'Delete Item'}
              </button>
            </div>

            {selectedEdge ? (
              <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                Connects <strong>{selectedEdge.fromNodeId}</strong> ↔ <strong>{selectedEdge.toNodeId}</strong>. Click "Delete Corridor Line" above to remove this connection.
              </div>
            ) : selectedFeature ? (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '3px' }}>
                    Edit Room Name:
                  </label>
                  <input
                    type="text"
                    value={selectedFeature.name}
                    onChange={(e) => updateSelectedRoomProperties({ name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #475569',
                      background: '#0f172a',
                      color: '#f8fafc',
                      fontSize: '12px',
                      fontWeight: 700
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '3px' }}>
                    Edit Room Type (Type any custom category):
                  </label>
                  <input
                    type="text"
                    list="custom-room-types"
                    value={selectedFeature.category}
                    onChange={(e) => updateSelectedRoomProperties({ category: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #475569',
                      background: '#0f172a',
                      color: '#f8fafc',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '2px' }}>
                      Width (m):
                    </label>
                    <input
                      type="number"
                      min={3}
                      max={60}
                      value={getFeatureDimensions(selectedFeature).w}
                      onChange={(e) =>
                        updateSelectedRoomProperties({ widthMeters: Number(e.target.value) })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        background: '#0f172a',
                        color: '#f8fafc',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '2px' }}>
                      Depth (m):
                    </label>
                    <input
                      type="number"
                      min={3}
                      max={60}
                      value={getFeatureDimensions(selectedFeature).d}
                      onChange={(e) =>
                        updateSelectedRoomProperties({ depthMeters: Number(e.target.value) })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        background: '#0f172a',
                        color: '#f8fafc',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '2px' }}>
                      Height (m):
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={15}
                      step={0.2}
                      value={selectedFeature.height}
                      onChange={(e) =>
                        updateSelectedRoomProperties({ height: Number(e.target.value) })
                      }
                      style={{
                        width: '100%',
                        padding: '6px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        background: '#0f172a',
                        color: '#f8fafc',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              selectedNode && (
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '3px' }}>
                    Edit Node Label:
                  </label>
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => {
                      const nextNodes = osmPackage.nodes.map((n) =>
                        n.id === selectedNode.id ? { ...n, label: e.target.value } : n
                      );
                      onUpdatePackage({ ...osmPackage, nodes: nextNodes }, 'Updated node label.');
                    }}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #475569',
                      background: '#0f172a',
                      color: '#f8fafc',
                      fontSize: '12px'
                    }}
                  />
                </div>
              )
            )}
          </div>
        )}

        {/* Tool-Specific Creation Panels */}
        {(toolMode === 'DROP_RECT_ROOM' || toolMode === 'DRAW_POLYGON_ROOM') && (
          <div style={{ background: '#1e293b', padding: '12px', borderRadius: '10px', border: '1px solid #334155', display: 'grid', gap: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#10b981' }}>
              NEW STANDALONE ROOM SETTINGS
            </div>
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Room Name (e.g. Robotics Lab 210)"
              style={{
                width: '100%',
                padding: '7px 9px',
                borderRadius: '6px',
                border: '1px solid #475569',
                background: '#0f172a',
                color: '#f8fafc',
                fontSize: '12px'
              }}
            />

            <div>
              <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '3px' }}>
                Enter Any Room Type / Category:
              </label>
              <input
                type="text"
                list="custom-room-types"
                value={newRoomType}
                onChange={(e) => setNewRoomType(e.target.value)}
                placeholder="Type any room type (e.g. server_room, lab, office)"
                style={{
                  width: '100%',
                  padding: '7px 9px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: '#f8fafc',
                  fontSize: '12px'
                }}
              />
              <datalist id="custom-room-types">
                <option value="office" />
                <option value="lecture_hall" />
                <option value="classroom" />
                <option value="robotics_lab" />
                <option value="accessible_restroom" />
                <option value="medical_room" />
                <option value="cafeteria" />
                <option value="lobby" />
                <option value="server_room" />
              </datalist>
            </div>

            {toolMode === 'DROP_RECT_ROOM' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8' }}>Width (m)</label>
                  <input
                    type="number"
                    value={newRoomWidth}
                    onChange={(e) => setNewRoomWidth(Number(e.target.value))}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', background: '#0f172a', color: '#fff', border: '1px solid #475569' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8' }}>Depth (m)</label>
                  <input
                    type="number"
                    value={newRoomDepth}
                    onChange={(e) => setNewRoomDepth(Number(e.target.value))}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', background: '#0f172a', color: '#fff', border: '1px solid #475569' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8' }}>Height (m)</label>
                  <input
                    type="number"
                    step={0.2}
                    value={newRoomHeight}
                    onChange={(e) => setNewRoomHeight(Number(e.target.value))}
                    style={{ width: '100%', padding: '6px', borderRadius: '6px', background: '#0f172a', color: '#fff', border: '1px solid #475569' }}
                  />
                </div>
              </div>
            )}

            {toolMode === 'DRAW_POLYGON_ROOM' && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={handleFinishPolygonRoom}
                  style={{
                    flex: 2,
                    padding: '8px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#10b981',
                    color: '#052e16',
                    fontWeight: 800,
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  <Check size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  Finish Polygon ({draftPolygonPoints.length} pts)
                </button>
                <button
                  onClick={() => setDraftPolygonPoints([])}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #ef4444',
                    background: '#0f172a',
                    color: '#f87171',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {toolMode === 'MANUAL_CONNECT_CORRIDOR' && (
          <div style={{ background: '#1e293b', padding: '12px', borderRadius: '10px', border: '2px solid #facc15', display: 'grid', gap: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#facc15', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Link2 size={14} />
              <span>MANUAL 2-CLICK CORRIDOR CONNECTOR</span>
            </div>
            <div style={{ fontSize: '11px', color: '#e2e8f0', lineHeight: 1.45 }}>
              <strong>Step 1:</strong> Click your <strong>Start Point</strong> (any Room, Corridor node, Stair, Ramp, Elevator, or empty space).<br />
              <strong>Step 2:</strong> Click your <strong>End Point</strong> to draw that single corridor line. It stops immediately after connecting!
            </div>

            {activeStartNode && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', padding: '6px 8px', borderRadius: '6px', border: '1px solid #facc15' }}>
                <span style={{ fontSize: '11px', color: '#fef08a', fontWeight: 700 }}>
                  Start: {activeStartNode.label}
                </span>
                <button
                  onClick={() => setCorridorStartNodeId(null)}
                  style={{
                    padding: '3px 7px',
                    borderRadius: '4px',
                    border: 'none',
                    background: '#dc2626',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Cancel Start
                </button>
              </div>
            )}

            <button
              onClick={handleClearFloorCorridors}
              style={{
                padding: '7px',
                borderRadius: '6px',
                border: '1px solid #f87171',
                background: '#0f172a',
                color: '#f87171',
                fontWeight: 700,
                fontSize: '11px',
                cursor: 'pointer'
              }}
            >
              Clear All Corridors on Floor L{drawLevel} (Wire From Scratch)
            </button>
          </div>
        )}

        {toolMode === 'DROP_TRANSIT' && (
          <div style={{ background: '#1e293b', padding: '12px', borderRadius: '10px', border: '1px solid #334155', display: 'grid', gap: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#c084fc' }}>
              DROP STANDALONE STAIRS, RAMP OR ELEVATOR
            </div>
            <select
              value={transitTypeToDrop}
              onChange={(e) => setTransitTypeToDrop(e.target.value as 'stairs' | 'ramp' | 'elevator')}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid #475569',
                background: '#0f172a',
                color: '#f8fafc',
                fontSize: '12px',
                fontWeight: 700
              }}
            >
              <option value="elevator">Wheelchair Passenger Elevator (Step-Free)</option>
              <option value="ramp">ADA Compliant Wheelchair Ramp (Step-Free)</option>
              <option value="stairs">Standard Stairwell (Excluded in Disability Mode)</option>
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#e2e8f0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoLinkVerticalShaftOnly}
                onChange={(e) => setAutoLinkVerticalShaftOnly(e.target.checked)}
              />
              <span>Create vertical shaft across floors ({osmPackage.levels.join(' ↔ ')}) — zero horizontal auto-corridors</span>
            </label>
          </div>
        )}

        <button
          onClick={onExportGeoJSON}
          style={{
            padding: '10px',
            borderRadius: '8px',
            border: '2px solid #38bdf8',
            background: '#0284c7',
            color: '#ffffff',
            fontWeight: 800,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <Download size={15} />
          Export Floorplan as OSM GeoJSON (.geojson)
        </button>

        <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '9px', borderRadius: '8px', fontSize: '11px', fontWeight: 600 }}>
          {statusNote}
        </div>
      </aside>

      {/* Right Extendable & Scrollable 2D Blueprint Canvas */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#090d16'
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            background: '#0f172a',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Move size={15} color="#38bdf8" />
            <span>
              Floor L{drawLevel} Blueprint • Area: {boundsW}m × {boundsD}m
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => handleExpandCanvasBounds(20, 0)}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid #38bdf8',
                background: '#1e293b',
                color: '#38bdf8',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <Maximize2 size={11} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              +20m Width
            </button>
            <button
              onClick={() => handleExpandCanvasBounds(0, 20)}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid #38bdf8',
                background: '#1e293b',
                color: '#38bdf8',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <Maximize2 size={11} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              +20m Depth
            </button>
            <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>Zoom:</span>
            <input
              type="range"
              min={0.6}
              max={1.8}
              step={0.1}
              value={canvasZoom}
              onChange={(e) => setCanvasZoom(Number(e.target.value))}
              style={{ width: '90px' }}
            />
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center'
          }}
        >
          <svg
            width={svgW}
            height={svgH}
            viewBox={`0 0 ${svgW} ${svgH}`}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasPointerMove}
            onMouseUp={() => setDragState(null)}
            onMouseLeave={() => setDragState(null)}
            onTouchMove={(e) => {
              if (!dragState || e.touches.length !== 1) return;
              const touch = e.touches[0];
              const rect = e.currentTarget.getBoundingClientRect();
              const px = ((touch.clientX - rect.left) / rect.width) * svgW;
              const py = ((touch.clientY - rect.top) / rect.height) * svgH;
              handleCanvasPointerMove({
                currentTarget: e.currentTarget,
                clientX: touch.clientX,
                clientY: touch.clientY
              } as unknown as React.MouseEvent<SVGSVGElement>);
            }}
            onTouchEnd={() => setDragState(null)}
            style={{
              background: '#0f172a',
              border: '2px solid #334155',
              borderRadius: '12px',
              cursor:
                toolMode === 'SELECT_DRAG_EDIT'
                  ? dragState
                    ? 'grabbing'
                    : 'grab'
                  : 'crosshair',
              userSelect: 'none',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
              flexShrink: 0
            }}
          >
            {Array.from({ length: Math.floor(boundsW / 4) + 1 }).map((_, i) => {
              const x = (i / (boundsW / 4)) * svgW;
              return <line key={`gx-${i}`} x1={x} y1={0} x2={x} y2={svgH} stroke="#1e293b" strokeWidth={1} />;
            })}
            {Array.from({ length: Math.floor(boundsD / 4) + 1 }).map((_, i) => {
              const y = (i / (boundsD / 4)) * svgH;
              return <line key={`gy-${i}`} x1={0} y1={y} x2={svgW} y2={y} stroke="#1e293b" strokeWidth={1} />;
            })}

            {osmPackage.edges.map((edge) => {
              const n1 = osmPackage.nodes.find((n) => n.id === edge.fromNodeId);
              const n2 = osmPackage.nodes.find((n) => n.id === edge.toNodeId);
              if (!n1 || !n2 || (n1.level !== drawLevel && n2.level !== drawLevel)) return null;
              const [x1, y1] = meterToPx(n1.x, n1.z);
              const [x2, y2] = meterToPx(n2.x, n2.z);
              const isVert = n1.level !== n2.level;
              const isEdgeSelected = selectedEdgeId === edge.id;
              return (
                <g
                  key={edge.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdgeId(edge.id);
                    setSelectedFeatureId(null);
                    setSelectedNodeId(null);
                    setStatusNote(
                      `Selected corridor line "${edge.id}" (${edge.distanceMeters}m). Click "Delete Corridor Line" in the left panel to remove it.`
                    );
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={
                      isEdgeSelected
                        ? '#facc15'
                        : edge.attributes.isStairs
                        ? '#ef4444'
                        : edge.attributes.isElevator || edge.attributes.isRamp
                        ? '#10b981'
                        : '#94a3b8'
                    }
                    strokeWidth={isEdgeSelected ? 6 : isVert ? 4 : 3.5}
                    strokeDasharray={isVert ? '6,4' : undefined}
                  />
                </g>
              );
            })}

            {toolMode === 'MANUAL_CONNECT_CORRIDOR' && activeStartNode && cursorMeters && (
              <line
                x1={meterToPx(activeStartNode.x, activeStartNode.z)[0]}
                y1={meterToPx(activeStartNode.x, activeStartNode.z)[1]}
                x2={meterToPx(cursorMeters[0], cursorMeters[1])[0]}
                y2={meterToPx(cursorMeters[0], cursorMeters[1])[1]}
                stroke="#facc15"
                strokeWidth={3}
                strokeDasharray="6,4"
                pointerEvents="none"
              />
            )}

            {levelFeatures.map((feat) => {
              const pts = feat.footprint
                .map(([mx, mz]) => meterToPx(mx, mz).join(','))
                .join(' ');
              const [cx, cy] = meterToPx(feat.centroid[0], feat.centroid[1]);
              const isSelected = selectedFeatureId === feat.id;
              const dims = getFeatureDimensions(feat);
              const [rx, ry] = meterToPx(
                feat.centroid[0] + dims.w / 2,
                feat.centroid[1] + dims.d / 2
              );

              return (
                <g key={feat.id}>
                  <polygon
                    points={pts}
                    fill={isSelected ? 'rgba(16, 185, 129, 0.35)' : 'rgba(56, 189, 248, 0.22)'}
                    stroke={isSelected ? '#10b981' : '#38bdf8'}
                    strokeWidth={isSelected ? 3 : 2}
                    style={{ cursor: toolMode === 'SELECT_DRAG_EDIT' ? 'move' : 'pointer' }}
                    onMouseDown={(ev) => {
                      ev.stopPropagation();
                      setSelectedFeatureId(feat.id);
                      setSelectedNodeId(feat.connectedNodeId);
                      setSelectedEdgeId(null);
                      if (toolMode === 'SELECT_DRAG_EDIT') {
                        setDragState({
                          type: 'ROOM',
                          id: feat.id,
                          startX: feat.centroid[0],
                          startZ: feat.centroid[1]
                        });
                      }
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const roomNode = osmPackage.nodes.find((n) => n.id === feat.connectedNodeId);
                      if (roomNode && toolMode === 'MANUAL_CONNECT_CORRIDOR') {
                        handleNodeClick(roomNode, ev);
                      }
                    }}
                  />
                  <text
                    x={cx}
                    y={cy - 4}
                    fill="#f8fafc"
                    fontSize="11"
                    fontWeight="bold"
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    {feat.name}
                  </text>
                  <text
                    x={cx}
                    y={cy + 10}
                    fill="#93c5fd"
                    fontSize="9.5"
                    textAnchor="middle"
                    pointerEvents="none"
                  >
                    [{feat.category}] {dims.w}m × {dims.d}m
                  </text>

                  {isSelected && (
                    <rect
                      x={rx - 6}
                      y={ry - 6}
                      width={12}
                      height={12}
                      rx={2}
                      fill="#facc15"
                      stroke="#0f172a"
                      strokeWidth={2}
                      style={{ cursor: 'nwse-resize' }}
                      onMouseDown={(ev) => {
                        ev.stopPropagation();
                        setDragState({
                          type: 'ROOM_RESIZE',
                          id: feat.id,
                          startX: feat.centroid[0],
                          startZ: feat.centroid[1]
                        });
                      }}
                    >
                      <title>Drag corner to resize room width & depth</title>
                    </rect>
                  )}
                </g>
              );
            })}

            {levelNodes.map((node) => {
              const [nx, ny] = meterToPx(node.x, node.z);
              const isSelected =
                selectedNodeId === node.id || corridorStartNodeId === node.id;
              return (
                <g
                  key={node.id}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                    setSelectedNodeId(node.id);
                    setSelectedEdgeId(null);
                    if (toolMode === 'SELECT_DRAG_EDIT') {
                      setDragState({
                        type: 'NODE',
                        id: node.id,
                        startX: node.x,
                        startZ: node.z
                      });
                    }
                  }}
                  onClick={(ev) => handleNodeClick(node, ev)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={nx}
                    cy={ny}
                    r={isSelected ? 10 : 7}
                    fill={
                      corridorStartNodeId === node.id
                        ? '#facc15'
                        : node.verticalTransit === 'stairs'
                        ? '#ef4444'
                        : node.verticalTransit === 'elevator' || node.verticalTransit === 'ramp'
                        ? '#10b981'
                        : node.category === 'corridor'
                        ? '#38bdf8'
                        : '#a855f7'
                    }
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                  {node.verticalTransit !== 'none' && (
                    <text
                      x={nx}
                      y={ny - 12}
                      fill="#fef08a"
                      fontSize="9.5"
                      fontWeight="bold"
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      [{node.verticalTransit.toUpperCase()}]
                    </text>
                  )}
                </g>
              );
            })}

            {levelAnchors.map((a) => {
              const [ax, ay] = meterToPx(a.coordinates.x, a.coordinates.z);
              return (
                <g
                  key={a.landmarkId}
                  style={{ cursor: 'move' }}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                    if (toolMode === 'SELECT_DRAG_EDIT') {
                      setDragState({
                        type: 'QR',
                        id: a.landmarkId,
                        startX: a.coordinates.x,
                        startZ: a.coordinates.z
                      });
                    }
                  }}
                >
                  <rect x={ax - 24} y={ay + 9} width={48} height={16} rx={4} fill="#fef08a" stroke="#ca8a04" />
                  <text x={ax} y={ay + 20} fill="#0f172a" fontSize="9.5" fontWeight="bold" textAnchor="middle">
                    {a.shortCode}
                  </text>
                </g>
              );
            })}

            {draftPolygonPoints.length > 0 && (
              <g>
                <polygon
                  points={draftPolygonPoints.map(([mx, mz]) => meterToPx(mx, mz).join(',')).join(' ')}
                  fill="rgba(16, 185, 129, 0.35)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  strokeDasharray="5,3"
                />
                {draftPolygonPoints.map(([mx, mz], idx) => {
                  const [px, py] = meterToPx(mx, mz);
                  return <circle key={`dp-${idx}`} cx={px} cy={py} r={6} fill="#10b981" stroke="#ffffff" strokeWidth={2} />;
                })}
              </g>
            )}
          </svg>
        </div>
      </main>
    </div>
  );
};

// ============================================================================
// 7. PURE THREE.JS 3D VIEWPORT (MULTI-FLOOR + STAIR-FREE MODE)
// ============================================================================
const CATEGORY_COLORS: Record<string, number> = {
  lobby: 0x0ea5e9,
  medical_room: 0xef4444,
  accessible_restroom: 0x8b5cf6,
  restroom: 0x8b5cf6,
  office: 0x3b82f6,
  lecture_hall: 0xf59e0b,
  cafeteria: 0x10b981,
  corridor: 0x334155,
  robotics_lab: 0x06b6d4
};

const Campus3DViewport: React.FC<{
  osmPackage: CampusOSMMapPackage;
  activeLevel: number | 'ALL';
  userPose: UserPose;
  activeRoute: ComputedRoute | null;
  edges: GraphEdge[];
  highContrastMode: boolean;
  isEmergencyMode: boolean;
  isStairFreeDisabilityMode: boolean;
  isAdminMode?: boolean;
  destinationId?: string;
  onSelectEdge?: (edge: GraphEdge) => void;
  onSelectDestinationNode?: (nodeId: string) => void;
}> = ({
  osmPackage,
  activeLevel,
  userPose,
  activeRoute,
  edges,
  highContrastMode,
  isEmergencyMode,
  isStairFreeDisabilityMode,
  isAdminMode = false,
  destinationId,
  onSelectEdge,
  onSelectDestinationNode
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null);
  const pulseMeshRef = useRef<THREE.Mesh | null>(null);
  const routePointsRef = useRef<THREE.Vector3[]>([]);

  const roomLabelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const transitLabelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const userLabelRef = useRef<HTMLDivElement | null>(null);

  const latestStateRef = useRef({ activeLevel, userPose, osmPackage });
  useEffect(() => {
    latestStateRef.current = { activeLevel, userPose, osmPackage };
  }, [activeLevel, userPose, osmPackage]);

  const verticalNodes = useMemo(
    () => osmPackage.nodes.filter((n) => n.verticalTransit !== 'none'),
    [osmPackage.nodes]
  );

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      600
    );
    camera.position.set(0, 46, 54);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 10;
    controls.maxDistance = 180;

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(25, 60, 25);
    scene.add(dirLight);

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);
    contentGroupRef.current = contentGroup;

    let animId = 0;
    let progress = 0;
    const clock = new THREE.Clock();
    const tempVec = new THREE.Vector3();

    const projectToDOM = (el: HTMLElement | null, x: number, y: number, z: number, visible: boolean) => {
      if (!el || !container) return;
      if (!visible) {
        el.style.display = 'none';
        return;
      }
      tempVec.set(x, y, z).project(camera);
      if (tempVec.z > 1) {
        el.style.display = 'none';
        return;
      }
      const px = (tempVec.x * 0.5 + 0.5) * container.clientWidth;
      const py = (-tempVec.y * 0.5 + 0.5) * container.clientHeight;
      el.style.display = 'block';
      el.style.transform = `translate(-50%, -50%) translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    };

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      controls.update();

      const pts = routePointsRef.current;
      if (pulseMeshRef.current && pts.length >= 2) {
        progress = (progress + delta * 0.4) % 1;
        const scaled = progress * (pts.length - 1);
        const idx = Math.floor(scaled);
        const t = scaled - idx;
        const p1 = pts[idx];
        const p2 = pts[Math.min(idx + 1, pts.length - 1)];
        pulseMeshRef.current.position.lerpVectors(p1, p2, t);
      }

      const {
        activeLevel: curLvl,
        userPose: curPose,
        osmPackage: curPkg
      } = latestStateRef.current;

      curPkg.features.forEach((feat) => {
        const show = curLvl === 'ALL' || curLvl === feat.level;
        projectToDOM(
          roomLabelRefs.current[feat.id] || null,
          feat.centroid[0],
          feat.minHeight + feat.height + 0.9,
          feat.centroid[1],
          show
        );
      });

      curPkg.nodes
        .filter((n) => n.verticalTransit !== 'none')
        .forEach((node) => {
          const show = curLvl === 'ALL' || curLvl === node.level;
          projectToDOM(transitLabelRefs.current[node.id] || null, node.x, node.y + 1.5, node.z, show);
        });

      projectToDOM(userLabelRef.current, curPose.x, curPose.y + 2.4, curPose.z, true);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const group = contentGroupRef.current;
    if (!scene || !group) return;

    scene.background = new THREE.Color(highContrastMode ? 0x000000 : 0x090d16);

    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
    pulseMeshRef.current = null;
    routePointsRef.current = [];

    const nodeMap = new Map<string, GraphNode>();
    osmPackage.nodes.forEach((n) => nodeMap.set(n.id, n));

    const slabW = osmPackage.canvasBounds?.widthMeters || 76;
    const slabD = osmPackage.canvasBounds?.depthMeters || 56;

    osmPackage.levels.forEach((lvl) => {
      const yPos = (lvl - 1) * 4.5 - 0.05;
      const isVisible = activeLevel === 'ALL' || activeLevel === lvl;

      const slabMesh = new THREE.Mesh(
        new THREE.BoxGeometry(slabW, 0.1, slabD),
        new THREE.MeshStandardMaterial({
          color: highContrastMode ? 0x111111 : 0x1e293b,
          transparent: true,
          opacity: isVisible ? 0.78 : 0.08
        })
      );
      slabMesh.position.set(0, yPos, 5);
      group.add(slabMesh);

      if (isVisible) {
        const grid = new THREE.GridHelper(
          Math.max(slabW, slabD),
          Math.floor(Math.max(slabW, slabD) / 2),
          0x334155,
          0x1e293b
        );
        grid.position.set(0, yPos + 0.06, 5);
        group.add(grid);
      }
    });

    osmPackage.features.forEach((feature) => {
      const isIsolated = activeLevel === 'ALL' || activeLevel === feature.level;
      const shape = new THREE.Shape();
      feature.footprint.forEach(([x, z], idx) => {
        if (idx === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
      });
      shape.closePath();

      const geom = new THREE.ExtrudeGeometry(shape, { depth: feature.height, bevelEnabled: false });
      geom.rotateX(-Math.PI / 2);

      const color = highContrastMode ? 0xffff00 : CATEGORY_COLORS[feature.category] || 0x3b82f6;
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity: isIsolated ? (highContrastMode ? 0.45 : 0.38) : 0.05,
          roughness: 0.4
        })
      );
      mesh.position.set(0, feature.minHeight, 0);
      group.add(mesh);
    });

    edges.forEach((edge) => {
      const n1 = nodeMap.get(edge.fromNodeId);
      const n2 = nodeMap.get(edge.toNodeId);
      if (!n1 || !n2) return;
      const visible = activeLevel === 'ALL' || n1.level === activeLevel || n2.level === activeLevel;
      if (!visible) return;

      const p1 = new THREE.Vector3(n1.x, n1.y + 0.15, n1.z);
      const p2 = new THREE.Vector3(n2.x, n2.y + 0.15, n2.z);
      const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);

      const isStairEdge = edge.attributes.isStairs || edge.attributes.verticalTransitType === 'stairs';
      let edgeColor = 0x64748b;
      if (edge.status === 'BLOCKED' || (isStairFreeDisabilityMode && isStairEdge)) {
        edgeColor = 0xef4444;
      } else if (edge.status === 'MAINTENANCE') {
        edgeColor = 0xf59e0b;
      } else if (isStairFreeDisabilityMode && (edge.attributes.isElevator || edge.attributes.isRamp)) {
        edgeColor = 0x10b981;
      }

      group.add(new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: edgeColor })));
    });

    osmPackage.nodes.forEach((node) => {
      const isVisible = activeLevel === 'ALL' || node.level === activeLevel;
      if (!isVisible) return;
      const isExit = node.lifeSafety === 'emergency_exit' || node.lifeSafety === 'muster_point';
      const isStairs = node.verticalTransit === 'stairs';
      const nodeMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, 0.35, 16),
        new THREE.MeshStandardMaterial({
          color:
            isStairFreeDisabilityMode && isStairs
              ? 0xef4444
              : isExit
              ? 0x22c55e
              : node.verticalTransit !== 'none'
              ? 0xa855f7
              : 0x64748b
        })
      );
      nodeMesh.position.set(node.x, node.y + 0.25, node.z);
      group.add(nodeMesh);
    });

    if (activeRoute && activeRoute.pathNodes.length >= 2) {
      const pts = activeRoute.pathNodes.map((n) => new THREE.Vector3(n.x, n.y + 0.5, n.z));
      routePointsRef.current = pts;
      const routeColor = isEmergencyMode
        ? 0xef4444
        : isStairFreeDisabilityMode
        ? 0x10b981
        : highContrastMode
        ? 0x00ff00
        : 0x38bdf8;

      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, 64, 0.28, 8, false),
          new THREE.MeshStandardMaterial({ color: routeColor, emissive: routeColor, emissiveIntensity: 0.65 })
        )
      );

      const pulseMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: routeColor, emissiveIntensity: 1.5 })
      );
      pulseMesh.position.copy(pts[0]);
      group.add(pulseMesh);
      pulseMeshRef.current = pulseMesh;
    }

    const userGroup = new THREE.Group();
    userGroup.position.set(userPose.x, userPose.y + 0.65, userPose.z);
    userGroup.rotation.y = (-userPose.headingDeg * Math.PI) / 180;
    userGroup.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 20, 20),
        new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.8 })
      )
    );
    const coneMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.5, 12),
      new THREE.MeshStandardMaterial({ color: 0xfacc15 })
    );
    coneMesh.position.set(0, 0, -1.4);
    coneMesh.rotation.x = -Math.PI / 2;
    userGroup.add(coneMesh);
    group.add(userGroup);
  }, [
    osmPackage,
    activeLevel,
    userPose,
    activeRoute,
    edges,
    highContrastMode,
    isEmergencyMode,
    isStairFreeDisabilityMode
  ]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* 3D Floating HTML Room & Transit Labels */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {osmPackage.features.map((feat) => {
          const isTarget = destinationId === feat.connectedNodeId;
          return (
            <button
              key={feat.id}
              ref={(el) => {
                roomLabelRefs.current[feat.id] = el;
              }}
              onClick={() => onSelectDestinationNode && onSelectDestinationNode(feat.connectedNodeId)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'auto',
                cursor: 'pointer',
                background: isTarget ? '#0284c7' : 'rgba(15, 23, 42, 0.88)',
                color: '#f8fafc',
                border: `1.5px solid ${isTarget ? '#38bdf8' : '#475569'}`,
                padding: '3px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 10px rgba(0,0,0,0.45)'
              }}
            >
              [L{feat.level}] {feat.name}
            </button>
          );
        })}

        {verticalNodes.map((node) => {
          const isStairs = node.verticalTransit === 'stairs';
          if (!isStairFreeDisabilityMode && node.level !== 1) return null;
          return (
            <div
              key={node.id}
              ref={(el) => {
                transitLabelRefs.current[node.id] = el;
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                background:
                  isStairFreeDisabilityMode && isStairs
                    ? '#991b1b'
                    : isStairFreeDisabilityMode
                    ? '#065f46'
                    : '#3b0764',
                color: '#ffffff',
                border: `1px solid ${
                  isStairFreeDisabilityMode && isStairs ? '#f87171' : '#6ee7b7'
                }`,
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 800,
                whiteSpace: 'nowrap'
              }}
            >
              {isStairFreeDisabilityMode && isStairs
                ? '⛔ STAIRS EXCLUDED'
                : `♿ ${node.verticalTransit.toUpperCase()}`}
            </div>
          );
        })}

        <div
          ref={userLabelRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            background: '#16a34a',
            color: '#ffffff',
            border: '1.5px solid #bbf7d0',
            padding: '2px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 800,
            whiteSpace: 'nowrap'
          }}
        >
          YOU ({userPose.lastAnchorCode})
        </div>
      </div>

      {/* Active Map Name & Telemetry HUD */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid #334155',
          borderRadius: '10px',
          padding: '8px 12px',
          fontSize: '12px',
          color: '#f8fafc',
          pointerEvents: 'none'
        }}
      >
        <div style={{ fontWeight: 800, color: '#38bdf8' }}>
          Active OSM Map: {osmPackage.mapName} ({osmPackage.levels.length} Floors)
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
          {isStairFreeDisabilityMode
            ? '♿ Person with Disability Mode Active: All stairs purged — routing exclusively via Elevators & ADA Ramps'
            : 'Click any floating 3D room label to navigate • Drag to orbit • Scroll to zoom'}
        </div>
      </div>

      {isAdminMode && onSelectEdge && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            right: '16px',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid #475569',
            borderRadius: '10px',
            padding: '10px',
            display: 'flex',
            gap: '6px',
            overflowX: 'auto'
          }}
        >
          {edges.map((e) => (
            <button
              key={e.id}
              onClick={() => onSelectEdge(e)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #64748b',
                background:
                  e.status === 'BLOCKED' ? '#dc2626' : e.status === 'MAINTENANCE' ? '#d97706' : '#1e293b',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                cursor: 'pointer'
              }}
            >
              {e.id.replace('E-', '')}: {e.status}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 8. MAIN APPLICATION (LOGIN GATEWAY + USER PORTAL + ADMIN PORTAL)
// ============================================================================
export const App: React.FC = () => {
  const [authSession, setAuthSession] = useState<{
    role: 'NONE' | 'USER' | 'ADMIN';
    displayName: string;
  }>({ role: 'NONE', displayName: '' });

  const [visitorName, setVisitorName] = useState('Campus Visitor');
  const [preEnableDisabilityMode, setPreEnableDisabilityMode] = useState(false);
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [osmPackage, setOsmPackage] = useState<CampusOSMMapPackage>(() => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_OSM_KEY);
      if (cached) return normalizeLoadedPackage(JSON.parse(cached));
    } catch {
      // Fallback
    }
    return DEFAULT_ACADEMIC_OSM_PACKAGE;
  });

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [facilityEmergencyActive, setFacilityEmergencyActive] = useState<boolean>(false);

  const [edgeStates, setEdgeStates] = useState<Record<string, EdgeOperationalStatus>>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_EDGES_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    const initial: Record<string, EdgeOperationalStatus> = {};
    DEFAULT_ACADEMIC_OSM_PACKAGE.edges.forEach((e) => (initial[e.id] = e.status));
    return initial;
  });

  const [userPose, setUserPose] = useState<UserPose>({
    buildingId: 'BLD-ALPHA',
    level: 1,
    x: -22,
    y: 0,
    z: 8,
    headingDeg: 90,
    nearestNodeId: 'N-L1-WEST',
    source: 'QR_SCAN',
    lastAnchorCode: 'FL1-W09'
  });
  const [activeLevel, setActiveLevel] = useState<number | 'ALL'>('ALL');
  const [selectedProfile, setSelectedProfile] = useState<RoutingProfile>('STANDARD');
  const [destinationId, setDestinationId] = useState<string>('N-L2-CONF-302');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(0);

  // User-Only Text-to-Speech (TTS) Navigation Audio State
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);

  // Camera & Universal jsQR + BarcodeDetector Scanner States
  const [qrModalOpen, setQrModalOpen] = useState<boolean>(false);
  const [shortCodeInput, setShortCodeInput] = useState<string>('');
  const [shortCodeError, setShortCodeError] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<'IDLE' | 'STREAMING' | 'ERROR'>('IDLE');
  const [cameraErrorDetail, setCameraErrorDetail] = useState<string>('');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [mirrorCamera, setMirrorCamera] = useState<boolean>(false);
  const [scannerEngineReady, setScannerEngineReady] = useState<string>('Initializing QR decoder...');
  const [framesScannedCount, setFramesScannedCount] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [adminTab, setAdminTab] = useState<'FLOORPLAN_DRAWER' | 'TWIN' | 'OSM_MANAGER' | 'BADGES'>('FLOORPLAN_DRAWER');
  const [osmUploadStatus, setOsmUploadStatus] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Load universal jsQR decoder script so desktop browsers can scan webcam frames
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).jsQR) {
      setScannerEngineReady('jsQR + Canvas Optical Scanner Active');
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    script.async = true;
    script.onload = () => setScannerEngineReady('jsQR + BarcodeDetector Dual Engine Active');
    script.onerror = () => setScannerEngineReady('Native BarcodeDetector Active');
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(`ws://${window.location.hostname}:8080`);
      wsRef.current = socket;
      socket.onopen = () => setWsConnected(true);
      socket.onclose = () => setWsConnected(false);
      socket.onerror = () => setWsConnected(false);
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WSMessage;
          if (msg.type === 'INIT_STATE') {
            if (Object.keys(msg.edgeStates || {}).length > 0) setEdgeStates(msg.edgeStates);
            setFacilityEmergencyActive(msg.emergencyActive);
            if (msg.customOsmPackage) {
              setOsmPackage(normalizeLoadedPackage(msg.customOsmPackage));
            }
          } else if (msg.type === 'TOGGLE_EDGE_STATUS') {
            setEdgeStates((prev) => ({ ...prev, [msg.edgeId]: msg.status }));
          } else if (msg.type === 'BROADCAST_EVACUATION') {
            setFacilityEmergencyActive(msg.active);
          } else if (msg.type === 'UPDATE_OSM_MAP') {
            const norm = normalizeLoadedPackage(msg.osmPackage);
            setOsmPackage(norm);
            localStorage.setItem(LOCAL_STORAGE_OSM_KEY, JSON.stringify(norm));
          }
        } catch {
          // ignore
        }
      };
    } catch {
      setWsConnected(false);
    }

    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === LOCAL_STORAGE_OSM_KEY && e.newValue) {
        try {
          setOsmPackage(normalizeLoadedPackage(JSON.parse(e.newValue)));
        } catch {
          // ignore
        }
      } else if (e.key === LOCAL_STORAGE_EDGES_KEY && e.newValue) {
        try {
          setEdgeStates(JSON.parse(e.newValue));
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handleStorageSync);

    return () => {
      window.removeEventListener('storage', handleStorageSync);
      if (socket) socket.close();
    };
  }, []);

  // ============================================================================
  // USER-ONLY TEXT-TO-SPEECH (TTS) VOICE SYNTHESIS ENGINE
  // ============================================================================
  const speakUserNavigation = (text: string, urgent = false) => {
    // Strictly restricted to USER role only
    if (authSession.role !== 'USER' || !ttsEnabled) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = urgent ? 1.05 : 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // Stop any speech immediately if user logs out or switches to Admin
  useEffect(() => {
    if (authSession.role !== 'USER' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [authSession.role]);

  const mergedEdges = useMemo(() => {
    return osmPackage.edges.map((e) => ({ ...e, status: edgeStates[e.id] || e.status }));
  }, [osmPackage.edges, edgeStates]);

  const isStairFreeDisabilityMode = selectedProfile === 'WHEELCHAIR_ADA';

  const activeRoute = useMemo(() => {
    return computePath(
      userPose.nearestNodeId,
      destinationId,
      selectedProfile,
      osmPackage.nodes,
      mergedEdges,
      facilityEmergencyActive
    );
  }, [userPose.nearestNodeId, destinationId, selectedProfile, osmPackage.nodes, mergedEdges, facilityEmergencyActive]);

  // Automatically announce route summary & Step 1 via TTS when User changes destination, profile, or emergency state
  useEffect(() => {
    if (authSession.role !== 'USER' || !ttsEnabled) return;
    setCurrentStepIdx(0);

    if (!activeRoute || activeRoute.instructions.length === 0) {
      speakUserNavigation('No connected corridor path found for the selected destination.');
      return;
    }

    const targetNode = activeRoute.pathNodes[activeRoute.pathNodes.length - 1];
    const firstStep = activeRoute.instructions[0]?.textDirective || '';

    if (facilityEmergencyActive) {
      speakUserNavigation(
        `Emergency evacuation active. Elevators are locked out. Routing ${activeRoute.totalDistanceMeters} meters to ${targetNode.label}. ${firstStep}`,
        true
      );
    } else {
      const modeLabel = isStairFreeDisabilityMode ? 'Stair-free accessible route' : 'Route';
      speakUserNavigation(
        `${modeLabel} to ${targetNode.label}, ${activeRoute.totalDistanceMeters} meters. Step 1: ${firstStep}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authSession.role,
    destinationId,
    selectedProfile,
    facilityEmergencyActive,
    userPose.nearestNodeId,
    ttsEnabled
  ]);

  const matchAnchorFromDecodedString = (rawText: string): QRLandmarkAnchor | undefined => {
    const clean = rawText.trim().toUpperCase();
    if (!clean) return undefined;
    return osmPackage.anchors.find(
      (a) =>
        clean === a.shortCode.toUpperCase() ||
        clean.includes(a.shortCode.toUpperCase()) ||
        clean.includes(a.landmarkId.toUpperCase())
    );
  };

  const scanCurrentVideoFrame = async (): Promise<boolean> => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return false;

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    setFramesScannedCount((c) => c + 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsQRFn = (window as any).jsQR;
    if (jsQRFn) {
      let canvas = scanCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        scanCanvasRef.current = canvas;
      }
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, vw, vh);
        const imgData = ctx.getImageData(0, 0, vw, vh);
        const codeA = jsQRFn(imgData.data, vw, vh, { inversionAttempts: 'attemptBoth' });
        if (codeA && codeA.data) {
          const found = matchAnchorFromDecodedString(String(codeA.data));
          if (found) {
            applyAnchor(found, 'QR_SCAN');
            setQrModalOpen(false);
            return true;
          }
        }

        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -vw, 0, vw, vh);
        ctx.restore();
        const imgDataFlipped = ctx.getImageData(0, 0, vw, vh);
        const codeB = jsQRFn(imgDataFlipped.data, vw, vh, { inversionAttempts: 'attemptBoth' });
        if (codeB && codeB.data) {
          const found = matchAnchorFromDecodedString(String(codeB.data));
          if (found) {
            applyAnchor(found, 'QR_SCAN');
            setQrModalOpen(false);
            return true;
          }
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BarcodeDetectorAPI = (window as any).BarcodeDetector;
    if (BarcodeDetectorAPI) {
      try {
        const detector = new BarcodeDetectorAPI({ formats: ['qr_code'] });
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          const found = matchAnchorFromDecodedString(String(barcodes[0].rawValue));
          if (found) {
            applyAnchor(found, 'QR_SCAN');
            setQrModalOpen(false);
            return true;
          }
        }
      } catch {
        // ignore
      }
    }

    return false;
  };

  useEffect(() => {
    if (!qrModalOpen) {
      setCameraStatus('IDLE');
      setFramesScannedCount(0);
      return;
    }

    let activeStream: MediaStream | null = null;
    let scanInterval: number | null = null;

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraStatus('ERROR');
        setCameraErrorDetail('Browser blocked camera API (upload a QR image or enter the short code below).');
        return;
      }

      try {
        const constraints: MediaStreamConstraints = selectedCameraId
          ? { video: { deviceId: { exact: selectedCameraId }, width: { ideal: 640 }, height: { ideal: 480 } } }
          : { video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } };

        try {
          activeStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          activeStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));

        if (videoRef.current && activeStream) {
          videoRef.current.srcObject = activeStream;
          await videoRef.current.play().catch(() => {});
          setCameraStatus('STREAMING');
          setCameraErrorDetail('');
        }

        scanInterval = window.setInterval(() => {
          scanCurrentVideoFrame();
        }, 220);
      } catch (err) {
        setCameraStatus('ERROR');
        setCameraErrorDetail(
          `Camera access unavailable (${(err as Error).message}). Upload a downloaded QR badge image or enter the 6-character short code below.`
        );
      }
    };

    startCamera();

    return () => {
      if (scanInterval) clearInterval(scanInterval);
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [qrModalOpen, selectedCameraId, osmPackage.anchors]);

  const handleQRImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsQRFn = (window as any).jsQR;
    if (jsQRFn && !file.name.endsWith('.svg')) {
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
          const code = jsQRFn(imgData.data, bitmap.width, bitmap.height, { inversionAttempts: 'attemptBoth' });
          if (code && code.data) {
            const found = matchAnchorFromDecodedString(String(code.data));
            if (found) {
              applyAnchor(found, 'QR_SCAN');
              setShortCodeError(null);
              setQrModalOpen(false);
              return;
            }
          }
        }
      } catch {
        // Fallback
      }
    }

    const upperName = file.name.toUpperCase();
    const matchedByName = osmPackage.anchors.find((a) => upperName.includes(a.shortCode.toUpperCase()));
    if (matchedByName) {
      applyAnchor(matchedByName, 'QR_SCAN');
      setShortCodeError(null);
      setQrModalOpen(false);
      return;
    }

    if (file.name.endsWith('.svg')) {
      const text = await file.text();
      const matchedInSvg = osmPackage.anchors.find((a) =>
        text.toUpperCase().includes(a.shortCode.toUpperCase())
      );
      if (matchedInSvg) {
        applyAnchor(matchedInSvg, 'QR_SCAN');
        setShortCodeError(null);
        setQrModalOpen(false);
        return;
      }
    }

    setShortCodeError('Could not decode QR from image. Enter the 6-character short code printed on the badge.');
  };

  const sendWSMessage = (msg: WSMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const publishNewOSMPackage = (nextPkg: CampusOSMMapPackage, statusBanner: string) => {
    setOsmPackage(nextPkg);
    localStorage.setItem(LOCAL_STORAGE_OSM_KEY, JSON.stringify(nextPkg));
    sendWSMessage({ type: 'UPDATE_OSM_MAP', osmPackage: nextPkg, updatedBy: authSession.displayName || 'Admin' });
    setOsmUploadStatus(statusBanner);
  };

  const handleBroadcastEvacuation = (active: boolean) => {
    setFacilityEmergencyActive(active);
    if (typeof document !== 'undefined') {
      document.documentElement.style.filter = active ? 'contrast(1.18) brightness(1.12)' : 'none';
    }
    sendWSMessage({ type: 'BROADCAST_EVACUATION', active, reason: 'Admin Emergency Override' });
  };

  const handleUpdateEdgeStatus = (edgeId: string, status: EdgeOperationalStatus) => {
    setEdgeStates((prev) => {
      const next = { ...prev, [edgeId]: status };
      localStorage.setItem(LOCAL_STORAGE_EDGES_KEY, JSON.stringify(next));
      return next;
    });
    sendWSMessage({ type: 'TOGGLE_EDGE_STATUS', edgeId, status, updatedBy: 'AdminConsole' });
  };

  const applyAnchor = (anchor: QRLandmarkAnchor, source: UserPose['source']) => {
    setUserPose({
      buildingId: anchor.buildingId,
      level: anchor.level,
      x: anchor.coordinates.x,
      y: anchor.coordinates.y,
      z: anchor.coordinates.z,
      headingDeg: anchor.headingDeg,
      nearestNodeId: anchor.connectedNodeId,
      source,
      lastAnchorCode: anchor.shortCode
    });
    speakUserNavigation(`Checkpoint locked at ${anchor.label}, Floor Level ${anchor.level}.`);
  };

  const handleExportOSMGeoJSONFile = () => {
    const geojsonStr = exportPackageAsOSMGeoJSON(osmPackage);
    const blob = new Blob([geojsonStr], { type: 'application/geo+json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${osmPackage.buildingId.toLowerCase()}-floorplan.osm.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAdminFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const compiled = parseUploadedOSMFile(String(reader.result), file.name);
        publishNewOSMPackage(
          compiled,
          `Loaded "${compiled.mapName}" (${compiled.levels.length} floors, ${compiled.features.length} rooms). All User Portals updated!`
        );
      } catch (err) {
        setOsmUploadStatus(`Upload Error: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  // ============================================================================
  // VIEW 1: DEDICATED LOGIN GATEWAY
  // ============================================================================
  if (authSession.role === 'NONE') {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: 'radial-gradient(circle at top, #1e293b 0%, #090d16 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          color: '#f8fafc'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <Compass size={34} color="#38bdf8" />
            <h1 style={{ fontSize: '26px', fontWeight: 900, letterSpacing: '0.4px' }}>
              3D INDOOR CAMPUS NAVIGATION & OSM FLOORPLAN STUDIO
            </h1>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>
            Active Campus Map: <strong style={{ color: '#38bdf8' }}>{osmPackage.mapName}</strong> ({osmPackage.levels.length} Floors • Updated {osmPackage.updatedAt})
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: '24px',
            maxWidth: '860px',
            width: '100%'
          }}
        >
          {/* User / Visitor Login */}
          <div
            style={{
              background: '#0f172a',
              border: '2px solid #0284c7',
              borderRadius: '16px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 20px 40px rgba(0,0,0,0.45)'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontWeight: 800, fontSize: '17px', marginBottom: '8px' }}>
                <UserCheck size={22} />
                <span>User / Visitor Navigation Portal</span>
              </div>
              <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '18px' }}>
                Navigate multi-floor 3D buildings with automatic Text-to-Speech (TTS) audio turn-by-turn guidance, live camera QR scanning, and 100% stair-free wheelchair routing.
              </p>

              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                Visitor / Student Name:
              </label>
              <input
                type="text"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#f8fafc',
                  fontSize: '14px',
                  marginBottom: '14px'
                }}
              />

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '10px',
                  background: preEnableDisabilityMode ? '#064e3b' : '#1e293b',
                  border: `2px solid ${preEnableDisabilityMode ? '#10b981' : '#334155'}`,
                  cursor: 'pointer',
                  marginBottom: '18px'
                }}
              >
                <input
                  type="checkbox"
                  checked={preEnableDisabilityMode}
                  onChange={(e) => setPreEnableDisabilityMode(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Accessibility size={16} color="#34d399" />
                    Person with Disability (Stair-Free Mode)
                  </div>
                  <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
                    Strictly excludes all stairs and routes only via elevators & ADA ramps
                  </div>
                </div>
              </label>
            </div>

            <button
              onClick={() => {
                if (preEnableDisabilityMode) {
                  setSelectedProfile('WHEELCHAIR_ADA');
                }
                setAuthSession({
                  role: 'USER',
                  displayName: visitorName.trim() || 'Campus Visitor'
                });
              }}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '10px',
                border: 'none',
                background: '#0284c7',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Enter 3D User Navigation Portal →
            </button>
          </div>

          {/* Facility Administrator Login */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (adminUser.trim() === 'admin' && adminPass === 'admin123') {
                setLoginError(null);
                setAuthSession({ role: 'ADMIN', displayName: 'Facility Administrator' });
              } else {
                setLoginError('Invalid credentials.');
              }
            }}
            style={{
              background: '#0f172a',
              border: '2px solid #7c3aed',
              borderRadius: '16px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 20px 40px rgba(0,0,0,0.45)'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c084fc', fontWeight: 800, fontSize: '17px', marginBottom: '8px' }}>
                <Lock size={20} />
                <span>Facility Administrator Login</span>
              </div>
              <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '18px' }}>
                Add multiple floors, drag-and-drop standalone rooms, resize & rename rooms after creation, manually connect/extend corridors, and broadcast facility evacuations.
              </p>

              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                Admin Username:
              </label>
              <input
                type="text"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#f8fafc',
                  fontSize: '14px',
                  marginBottom: '12px'
                }}
              />

              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                Admin Password:
              </label>
              <input
                type="password"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#f8fafc',
                  fontSize: '14px',
                  marginBottom: '12px'
                }}
              />

              {loginError && (
                <div style={{ color: '#f87171', fontSize: '12px', fontWeight: 700, marginBottom: '10px' }}>
                  {loginError}
                </div>
              )}
            </div>

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '10px',
                border: 'none',
                background: '#7c3aed',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Login to Admin Floorplan & Incident Studio →
            </button>
          </form>
        </div>
      </div>
    );
  }

  const highContrastMode = selectedProfile === 'VISUALLY_IMPAIRED' || facilityEmergencyActive;
  const activeInstruction = activeRoute?.instructions[currentStepIdx] || activeRoute?.instructions[0];
  const filteredDestinations = osmPackage.nodes.filter((n) =>
    n.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedLevelsDesc = [...osmPackage.levels].sort((a, b) => b - a);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#0f172a', color: '#f8fafc' }}>
      {/* Top Role Header */}
      <header
        style={{
          height: '54px',
          background: '#090d16',
          borderBottom: '1px solid #1e293b',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Compass size={22} color="#38bdf8" />
          <span style={{ fontWeight: 800, fontSize: '15px' }}>
            {authSession.role === 'ADMIN'
              ? 'FACILITY ADMIN PORTAL — 100% MANUAL OSM FLOORPLAN STUDIO'
              : 'USER 3D NAVIGATION PORTAL'}
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '99px',
              background: wsConnected ? '#064e3b' : '#334155',
              color: wsConnected ? '#6ee7b7' : '#cbd5e1',
              fontWeight: 600
            }}
          >
            {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {wsConnected ? 'Live Sync' : 'Local Sync Ready'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {authSession.role === 'ADMIN' && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => setAdminTab('FLOORPLAN_DRAWER')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: adminTab === 'FLOORPLAN_DRAWER' ? '#10b981' : '#1e293b',
                  color: adminTab === 'FLOORPLAN_DRAWER' ? '#052e16' : '#ffffff',
                  fontWeight: 800,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <PenTool size={13} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                Floorplan Studio (Manual Control)
              </button>
              <button
                onClick={() => setAdminTab('TWIN')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: adminTab === 'TWIN' ? '#7c3aed' : '#1e293b',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <Shield size={13} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                3D Twin & Hazards
              </button>
              <button
                onClick={() => setAdminTab('OSM_MANAGER')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: adminTab === 'OSM_MANAGER' ? '#0284c7' : '#1e293b',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <FileJson size={13} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                Upload / Export OSM GeoJSON
              </button>
              <button
                onClick={() => setAdminTab('BADGES')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: adminTab === 'BADGES' ? '#d97706' : '#1e293b',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <Printer size={13} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                Downloadable QR Badges
              </button>
            </div>
          )}

          <button
            onClick={() => setAuthSession({ role: 'NONE', displayName: '' })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #475569',
              background: '#1e293b',
              color: '#f8fafc',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            <LogOut size={13} />
            Switch Role
          </button>
        </div>
      </header>

      {/* Guidance & Closed-Caption Banner (Emergency Trigger Button Removed from User Tab) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: facilityEmergencyActive ? '#991b1b' : '#1e293b',
          borderBottom: `2px solid ${facilityEmergencyActive ? '#f87171' : '#334155'}`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {facilityEmergencyActive ? <ShieldAlert size={22} color="#fef08a" /> : <Volume2 size={18} color="#38bdf8" />}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: facilityEmergencyActive ? '#fef08a' : '#f8fafc' }}>
              {facilityEmergencyActive
                ? 'ADMIN EMERGENCY EVACUATION BROADCAST ACTIVE — ELEVATORS LOCKED OUT'
                : `Active OSM Map: ${osmPackage.mapName} • Live Guidance Feed`}
            </div>
            {authSession.role === 'USER' && activeInstruction && (
              <div style={{ fontSize: '12px', color: '#ffffff', marginTop: '2px' }}>
                [TTS / CC] {activeInstruction.textDirective}
              </div>
            )}
          </div>
        </div>

        {/* Emergency Evacuation Button is ONLY visible to ADMIN */}
        {authSession.role === 'ADMIN' && (
          <button
            onClick={() => handleBroadcastEvacuation(!facilityEmergencyActive)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '2px solid #ef4444',
              background: facilityEmergencyActive ? '#fef08a' : '#dc2626',
              color: facilityEmergencyActive ? '#7f1d1d' : '#ffffff',
              fontWeight: 800,
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            <AlertTriangle size={16} />
            {facilityEmergencyActive ? 'DEACTIVATE EVACUATION' : 'BROADCAST EMERGENCY EVACUATION'}
          </button>
        )}
      </div>

      {/* =====================================================================
          VIEW 2: DEDICATED USER PORTAL (TTS NAVIGATION ENABLED • NO MEET-ME • NO EVAC BUTTON)
      ===================================================================== */}
      {authSession.role === 'USER' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <aside
            style={{
              width: '385px',
              background: highContrastMode ? '#000000' : '#0f172a',
              borderRight: '1px solid #334155',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              overflowY: 'auto'
            }}
          >
            {/* 1. Person with Disability (100% Stair-Free) Toggle Card */}
            <div
              style={{
                background: isStairFreeDisabilityMode ? '#064e3b' : '#1e293b',
                border: `2px solid ${isStairFreeDisabilityMode ? '#10b981' : '#475569'}`,
                borderRadius: '10px',
                padding: '12px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '13px', color: isStairFreeDisabilityMode ? '#6ee7b7' : '#f8fafc' }}>
                  <Accessibility size={18} color={isStairFreeDisabilityMode ? '#34d399' : '#c084fc'} />
                  <span>PERSON WITH DISABILITY MODE</span>
                </div>
                <button
                  onClick={() =>
                    setSelectedProfile(isStairFreeDisabilityMode ? 'STANDARD' : 'WHEELCHAIR_ADA')
                  }
                  style={{
                    padding: '5px 12px',
                    borderRadius: '99px',
                    border: 'none',
                    background: isStairFreeDisabilityMode ? '#10b981' : '#334155',
                    color: isStairFreeDisabilityMode ? '#052e16' : '#f8fafc',
                    fontWeight: 900,
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  {isStairFreeDisabilityMode ? 'STAIR-FREE ON ✓' : 'ENABLE STAIR-FREE'}
                </button>
              </div>

              <div style={{ fontSize: '11px', color: '#e2e8f0', marginBottom: '6px' }}>
                {isStairFreeDisabilityMode
                  ? 'All stairwells are excluded (shown in red in 3D). Routing uses only Wheelchair Elevators and ADA Ramps.'
                  : 'Enable to remove all stairs and route exclusively through elevators and ramps.'}
              </div>

              {activeRoute && (
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.75)',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: activeRoute.stairsUsedCount === 0 ? '#6ee7b7' : '#fca5a5'
                  }}
                >
                  {activeRoute.stairsUsedCount === 0
                    ? `✓ Verified 0 Stairs on Route (${
                        activeRoute.accessibleTransitUsed[0] || 'Same-Floor Step-Free Path'
                      })`
                    : `⚠️ Standard Route uses ${activeRoute.stairsUsedCount} Stairwell(s) — Enable Stair-Free Mode to bypass!`}
                </div>
              )}
            </div>

            {/* 2. Zero-GPS QR Camera & Short-Code Localization */}
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#38bdf8' }}>
                  ZERO-GPS QR & SHORT-CODE ANCHOR
                </span>
                <span style={{ fontSize: '10px', background: '#065f46', color: '#6ee7b7', padding: '2px 6px', borderRadius: '99px', fontWeight: 700 }}>
                  {userPose.source}
                </span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>
                Active Checkpoint: <span style={{ color: '#facc15' }}>{userPose.lastAnchorCode}</span> • Floor L{userPose.level}
              </div>

              <button
                onClick={() => setQrModalOpen(true)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#0284c7',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                <Camera size={16} />
                Open Camera QR Scanner / Short-Code
              </button>
            </div>

            {/* 3. User-Only Text-to-Speech (TTS) Audio Guidance Controller */}
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', border: '1px solid #38bdf8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                  <span>TEXT-TO-SPEECH (TTS) VOICE GUIDANCE</span>
                </span>
                <button
                  onClick={() => {
                    const next = !ttsEnabled;
                    setTtsEnabled(next);
                    if (!next && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '99px',
                    border: 'none',
                    background: ttsEnabled ? '#0284c7' : '#475569',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {ttsEnabled ? 'AUDIO ON 🔊' : 'MUTED 🔇'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => {
                    if (activeInstruction) {
                      speakUserNavigation(
                        `Step ${currentStepIdx + 1}: ${activeInstruction.textDirective}`,
                        facilityEmergencyActive
                      );
                    }
                  }}
                  disabled={!ttsEnabled || !activeInstruction}
                  style={{
                    flex: 1,
                    padding: '7px',
                    borderRadius: '6px',
                    border: '1px solid #38bdf8',
                    background: '#0f172a',
                    color: '#38bdf8',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Speak Current Step
                </button>
                <button
                  onClick={() => {
                    if (activeRoute && activeRoute.instructions.length > 0) {
                      const fullSummary = activeRoute.instructions
                        .map((inst, i) => `Step ${i + 1}: ${inst.textDirective}`)
                        .join(' ');
                      speakUserNavigation(fullSummary, facilityEmergencyActive);
                    }
                  }}
                  disabled={!ttsEnabled || !activeRoute}
                  style={{
                    flex: 1,
                    padding: '7px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Speak Full Route
                </button>
              </div>
            </div>

            {/* 4. Destination & Turn-by-Turn Instructions with Step Controls */}
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', border: '1px solid #334155', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700 }}>
                  <Navigation size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  DESTINATION & TURN-BY-TURN
                </span>
              </div>

              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search rooms in current OSM map..."
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: '#f8fafc',
                  fontSize: '12px',
                  marginBottom: '6px'
                }}
              />

              <select
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                disabled={facilityEmergencyActive}
                style={{
                  width: '100%',
                  padding: '7px',
                  borderRadius: '6px',
                  background: '#0f172a',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  fontSize: '12px',
                  marginBottom: '8px'
                }}
              >
                {filteredDestinations.map((n) => (
                  <option key={n.id} value={n.id}>
                    [L{n.level}] {n.label} ({n.category || 'node'})
                  </option>
                ))}
              </select>

              {activeRoute ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#38bdf8', marginBottom: '8px' }}>
                    <span>Distance: {activeRoute.totalDistanceMeters}m</span>
                    <span>ETA: {activeRoute.estimatedSeconds}s</span>
                  </div>

                  {/* Previous / Next Step Audio Stepper */}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                    <button
                      onClick={() => {
                        const prevIdx = Math.max(0, currentStepIdx - 1);
                        setCurrentStepIdx(prevIdx);
                        const inst = activeRoute.instructions[prevIdx];
                        if (inst) {
                          speakUserNavigation(
                            `Step ${prevIdx + 1}: ${inst.textDirective}`,
                            facilityEmergencyActive
                          );
                        }
                      }}
                      disabled={currentStepIdx === 0}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        background: '#0f172a',
                        color: currentStepIdx === 0 ? '#475569' : '#f8fafc',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: currentStepIdx === 0 ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      <ChevronLeft size={13} />
                      Prev Step
                    </button>
                    <button
                      onClick={() => {
                        const nextIdx = Math.min(
                          activeRoute.instructions.length - 1,
                          currentStepIdx + 1
                        );
                        setCurrentStepIdx(nextIdx);
                        const inst = activeRoute.instructions[nextIdx];
                        if (inst) {
                          speakUserNavigation(
                            `Step ${nextIdx + 1}: ${inst.textDirective}`,
                            facilityEmergencyActive
                          );
                        }
                      }}
                      disabled={currentStepIdx >= activeRoute.instructions.length - 1}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '6px',
                        border: 'none',
                        background:
                          currentStepIdx >= activeRoute.instructions.length - 1
                            ? '#334155'
                            : '#10b981',
                        color:
                          currentStepIdx >= activeRoute.instructions.length - 1
                            ? '#94a3b8'
                            : '#052e16',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor:
                          currentStepIdx >= activeRoute.instructions.length - 1
                            ? 'default'
                            : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px'
                      }}
                    >
                      Next Step
                      <ChevronRight size={13} />
                    </button>
                  </div>

                  <div style={{ display: 'grid', gap: '5px', maxHeight: '175px', overflowY: 'auto' }}>
                    {activeRoute.instructions.map((inst, idx) => (
                      <div
                        key={inst.stepIndex}
                        onClick={() => {
                          setCurrentStepIdx(idx);
                          speakUserNavigation(
                            `Step ${idx + 1}: ${inst.textDirective}`,
                            facilityEmergencyActive
                          );
                        }}
                        style={{
                          padding: '6px 8px',
                          borderRadius: '6px',
                          background: idx === currentStepIdx ? '#1e3a8a' : '#0f172a',
                          border: `1px solid ${idx === currentStepIdx ? '#60a5fa' : '#334155'}`,
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        <strong>Step {idx + 1} (L{inst.level}):</strong> {inst.textDirective}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: '#f87171', fontSize: '12px', fontWeight: 700 }}>
                  This room is not connected to a corridor yet. In the Admin Floorplan Studio, use Tool 3 (Manual Connect Corridor) to link this room to your corridor network!
                </div>
              )}
            </div>
          </aside>

          <main style={{ flex: 1, position: 'relative' }}>
            <Campus3DViewport
              osmPackage={osmPackage}
              activeLevel={activeLevel}
              userPose={userPose}
              activeRoute={activeRoute}
              edges={mergedEdges}
              highContrastMode={highContrastMode}
              isEmergencyMode={facilityEmergencyActive}
              isStairFreeDisabilityMode={isStairFreeDisabilityMode}
              destinationId={destinationId}
              onSelectDestinationNode={(nodeId) => {
                if (!facilityEmergencyActive) setDestinationId(nodeId);
              }}
            />

            {/* Dynamic Multi-Floor 3D Level Slicer */}
            <div
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid #334155',
                borderRadius: '10px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textAlign: 'center' }}>
                <Layers size={12} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
                LEVEL SLICE
              </div>
              <button
                onClick={() => setActiveLevel('ALL')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeLevel === 'ALL' ? '#0284c7' : '#1e293b',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                All Floors
              </button>
              {sortedLevelsDesc.map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setActiveLevel(lvl)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: activeLevel === lvl ? '#0284c7' : '#1e293b',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Floor L{lvl}
                </button>
              ))}
            </div>
          </main>
        </div>
      )}

      {/* =====================================================================
          VIEW 3: DEDICATED ADMIN PORTAL
      ===================================================================== */}
      {authSession.role === 'ADMIN' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {adminTab === 'FLOORPLAN_DRAWER' && (
            <AdminFloorplanStudio
              osmPackage={osmPackage}
              onUpdatePackage={(nextPkg, msg) => publishNewOSMPackage(nextPkg, msg)}
              onExportGeoJSON={handleExportOSMGeoJSONFile}
            />
          )}

          {adminTab === 'OSM_MANAGER' && (
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: '#0f172a' }}>
              <div style={{ maxWidth: '960px', margin: '0 auto', display: 'grid', gap: '20px' }}>
                <div
                  style={{
                    background: '#1e293b',
                    border: '2px solid #0284c7',
                    borderRadius: '14px',
                    padding: '20px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>
                        OpenStreetMap (OSM) GeoJSON File Import & Export
                      </h2>
                      <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                        Upload any `.geojson` or `.json` floorplan file, or export your multi-floor custom floorplan as an OSM GeoJSON FeatureCollection.
                      </p>
                    </div>
                    <button
                      onClick={handleExportOSMGeoJSONFile}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        border: '1px solid #38bdf8',
                        background: '#0f172a',
                        color: '#38bdf8',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      <Download size={15} />
                      Export Active Map as OSM .geojson
                    </button>
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '24px',
                      border: '2px dashed #38bdf8',
                      borderRadius: '12px',
                      background: '#0f172a',
                      cursor: 'pointer',
                      marginBottom: '14px'
                    }}
                  >
                    <Upload size={28} color="#38bdf8" style={{ marginBottom: '8px' }} />
                    <span style={{ fontWeight: 800, fontSize: '14px', color: '#f8fafc' }}>
                      Click to Upload OSM Indoor File (`.geojson` or `.json`)
                    </span>
                    <input
                      type="file"
                      accept=".json,.geojson,application/json"
                      onChange={handleAdminFileUpload}
                      style={{ display: 'none' }}
                    />
                  </label>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    <button
                      onClick={() =>
                        publishNewOSMPackage(
                          { ...DEFAULT_ACADEMIC_OSM_PACKAGE, updatedAt: new Date().toLocaleTimeString() },
                          'Switched active OSM file to Main Engineering & Academic Block (BLD-ALPHA).'
                        )
                      }
                      style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #475569',
                        background: osmPackage.buildingId === 'BLD-ALPHA' ? '#0284c7' : '#0f172a',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      <RefreshCw size={13} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                      Load Preset 1: Academic Engineering Block (BLD-ALPHA)
                    </button>

                    <button
                      onClick={() =>
                        publishNewOSMPackage(
                          { ...HOSPITAL_RESEARCH_OSM_PACKAGE, updatedAt: new Date().toLocaleTimeString() },
                          'Switched active OSM file to Bio-Medical Research & Hospital Wing (BLD-OMEGA).'
                        )
                      }
                      style={{
                        flex: 1,
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #475569',
                        background: osmPackage.buildingId === 'BLD-OMEGA' ? '#0284c7' : '#0f172a',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      <RefreshCw size={13} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                      Load Preset 2: Bio-Medical Hospital Wing (BLD-OMEGA)
                    </button>
                  </div>

                  {osmUploadStatus && (
                    <div
                      style={{
                        marginTop: '14px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: '#064e3b',
                        color: '#6ee7b7',
                        fontSize: '13px',
                        fontWeight: 700
                      }}
                    >
                      {osmUploadStatus}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {adminTab === 'TWIN' && (
            <>
              <aside
                style={{
                  width: '390px',
                  background: '#0f172a',
                  borderRight: '1px solid #334155',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  overflowY: 'auto'
                }}
              >
                <div>
                  <h2 style={{ fontSize: '15px', fontWeight: 800 }}>CORRIDOR & TRANSIT INCIDENT CONTROL</h2>
                  <p style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Active OSM Map: <strong style={{ color: '#38bdf8' }}>{osmPackage.mapName}</strong>
                  </p>
                </div>

                <div
                  style={{
                    background: facilityEmergencyActive ? '#7f1d1d' : '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '10px',
                    padding: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, fontSize: '12px', marginBottom: '6px' }}>
                    <Radio size={16} color="#ef4444" />
                    <span>FACILITY-WIDE EVACUATION BROADCAST</span>
                  </div>
                  <button
                    onClick={() => handleBroadcastEvacuation(!facilityEmergencyActive)}
                    style={{
                      width: '100%',
                      padding: '9px',
                      borderRadius: '6px',
                      border: 'none',
                      background: facilityEmergencyActive ? '#fef08a' : '#dc2626',
                      color: facilityEmergencyActive ? '#7f1d1d' : '#ffffff',
                      fontWeight: 800,
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    {facilityEmergencyActive ? 'END EVACUATION OVERRIDE' : 'BROADCAST EMERGENCY EVACUATION'}
                  </button>
                </div>

                <div style={{ display: 'grid', gap: '6px', overflowY: 'auto' }}>
                  {mergedEdges.map((edge) => (
                    <div
                      key={edge.id}
                      style={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        padding: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700 }}>{edge.id}</div>
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                          {edge.fromNodeId} ↔ {edge.toNodeId} ({edge.distanceMeters}m)
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(['ACTIVE', 'MAINTENANCE', 'BLOCKED'] as EdgeOperationalStatus[]).map((st) => {
                          const active = edge.status === st;
                          const bg = st === 'ACTIVE' ? '#15803d' : st === 'MAINTENANCE' ? '#b45309' : '#b91c1c';
                          return (
                            <button
                              key={st}
                              onClick={() => handleUpdateEdgeStatus(edge.id, st)}
                              style={{
                                padding: '4px 6px',
                                borderRadius: '4px',
                                border: active ? '1px solid #ffffff' : 'none',
                                background: active ? bg : '#0f172a',
                                color: active ? '#ffffff' : '#64748b',
                                fontSize: '10px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px'
                              }}
                            >
                              {st === 'ACTIVE' && <CheckCircle size={10} />}
                              {st === 'MAINTENANCE' && <Wrench size={10} />}
                              {st === 'BLOCKED' && <Ban size={10} />}
                              {st.slice(0, 5)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </aside>

              <main style={{ flex: 1, position: 'relative' }}>
                <Campus3DViewport
                  osmPackage={osmPackage}
                  activeLevel={activeLevel}
                  userPose={userPose}
                  activeRoute={activeRoute}
                  edges={mergedEdges}
                  highContrastMode={false}
                  isEmergencyMode={facilityEmergencyActive}
                  isStairFreeDisabilityMode={false}
                  isAdminMode={true}
                  destinationId={destinationId}
                  onSelectEdge={(edge) => {
                    const order: EdgeOperationalStatus[] = ['ACTIVE', 'MAINTENANCE', 'BLOCKED'];
                    const next = order[(order.indexOf(edge.status) + 1) % order.length];
                    handleUpdateEdgeStatus(edge.id, next);
                  }}
                />
              </main>
            </>
          )}

          {adminTab === 'BADGES' && (
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: '#0f172a' }}>
              <div style={{ maxWidth: '1040px', margin: '0 auto', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 800 }}>
                    Downloadable ISO/IEC 18004 QR & Short-Code Badges ({osmPackage.anchors.length})
                  </h2>
                  <p style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Every badge encodes a real Reed-Solomon ISO QR matrix. Scan directly from your phone screen or print/download as PNG/SVG.
                  </p>
                </div>
                <button
                  onClick={() => window.print()}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Printer size={15} />
                  Print Full Sheet
                </button>
              </div>

              <div
                style={{
                  maxWidth: '1040px',
                  margin: '0 auto',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '18px'
                }}
              >
                {osmPackage.anchors.map((anchor) => (
                  <div
                    key={anchor.landmarkId}
                    style={{
                      background: '#ffffff',
                      color: '#0f172a',
                      borderRadius: '14px',
                      padding: '18px',
                      border: '3px solid #0284c7',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center'
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        background: '#0f172a',
                        color: '#38bdf8',
                        padding: '5px',
                        borderRadius: '6px',
                        fontSize: '10px',
                        fontWeight: 800,
                        marginBottom: '10px'
                      }}
                    >
                      {anchor.buildingId} • FLOOR L{anchor.level} • HDG {anchor.headingDeg}°
                    </div>
                    <QRCodeSVG shortCode={anchor.shortCode} size={160} />
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '10px' }}>{anchor.label}</div>
                    <div
                      style={{
                        marginTop: '8px',
                        width: '100%',
                        background: '#fef08a',
                        border: '2px dashed #ca8a04',
                        borderRadius: '8px',
                        padding: '6px'
                      }}
                    >
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#854d0e' }}>SHORT CODE</div>
                      <div style={{ fontSize: '18px', fontWeight: 900 }}>{anchor.shortCode}</div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '12px' }}>
                      <button
                        onClick={() => downloadQRBadgeAsPNG(anchor)}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '6px',
                          border: 'none',
                          background: '#0284c7',
                          color: '#ffffff',
                          fontWeight: 800,
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px'
                        }}
                      >
                        <Download size={13} />
                        Download PNG
                      </button>
                      <button
                        onClick={() => downloadQRBadgeAsSVG(anchor)}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #0f172a',
                          background: '#f8fafc',
                          color: '#0f172a',
                          fontWeight: 800,
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px'
                        }}
                      >
                        <Download size={13} />
                        Download SVG
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          LIVE WEBRTC CAMERA QR SCANNER (jsQR + BarcodeDetector), IMAGE UPLOADER & SHORT-CODE MODAL
      ===================================================================== */}
      {qrModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.88)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '14px',
              maxWidth: '530px',
              width: '100%',
              padding: '20px',
              maxHeight: '92vh',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800 }}>
                <QrCode size={20} color="#38bdf8" />
                <span>Live Camera QR Scanner & Short-Code Failover</span>
              </div>
              <button
                onClick={() => setQrModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#0f172a',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #334155',
                fontSize: '11px',
                marginBottom: '10px'
              }}
            >
              <span style={{ color: '#6ee7b7', fontWeight: 700 }}>
                ● {scannerEngineReady}
              </span>
              <span style={{ color: '#94a3b8' }}>
                Frames Scanned: <strong>{framesScannedCount}</strong>
              </span>
            </div>

            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              {videoDevices.length > 1 && (
                <select
                  value={selectedCameraId}
                  onChange={(e) => setSelectedCameraId(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: '#0f172a',
                    color: '#f8fafc',
                    border: '1px solid #475569',
                    fontSize: '12px'
                  }}
                >
                  <option value="">Default Camera</option>
                  {videoDevices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}

              <button
                onClick={() => setMirrorCamera((m) => !m)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: '#cbd5e1',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <FlipHorizontal size={13} />
                Flip Camera
              </button>

              <button
                onClick={() => scanCurrentVideoFrame()}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#10b981',
                  color: '#052e16',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                Capture & Scan Now
              </button>
            </div>

            <div
              style={{
                position: 'relative',
                height: '210px',
                background: '#0f172a',
                borderRadius: '10px',
                border: '2px solid #38bdf8',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '12px'
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: mirrorCamera ? 'scaleX(-1)' : 'none',
                  display: cameraStatus === 'STREAMING' ? 'block' : 'none'
                }}
              />
              {cameraStatus === 'STREAMING' && (
                <div
                  style={{
                    position: 'absolute',
                    width: '140px',
                    height: '140px',
                    border: '2px dashed #22c55e',
                    borderRadius: '12px',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)',
                    pointerEvents: 'none'
                  }}
                />
              )}
              {cameraStatus !== 'STREAMING' && (
                <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                  <Camera size={28} color="#38bdf8" style={{ marginBottom: '6px' }} />
                  <div>
                    {cameraStatus === 'IDLE'
                      ? 'Requesting camera permission...'
                      : cameraErrorDetail}
                  </div>
                </div>
              )}
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '9px',
                borderRadius: '8px',
                border: '1px solid #38bdf8',
                background: '#0f172a',
                color: '#38bdf8',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer',
                marginBottom: '14px'
              }}
            >
              <Upload size={15} />
              Upload QR Badge Image File (.png / .svg) to Scan Instantly
              <input
                type="file"
                accept=".png,.svg,.jpg,.jpeg,image/*"
                onChange={handleQRImageFileUpload}
                style={{ display: 'none' }}
              />
            </label>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const match = osmPackage.anchors.find(
                  (a) => a.shortCode.toUpperCase() === shortCodeInput.trim().toUpperCase()
                );
                if (match) {
                  applyAnchor(match, 'SHORT_CODE_FAILOVER');
                  setShortCodeError(null);
                  setShortCodeInput('');
                  setQrModalOpen(false);
                } else {
                  setShortCodeError('Short code not found. Try FL1-A01, FL1-W09, or FL2-E14.');
                }
              }}
              style={{ marginBottom: '14px' }}
            >
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                <Hash size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Damaged QR Failover Short Code:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={shortCodeInput}
                  onChange={(e) => setShortCodeInput(e.target.value)}
                  placeholder="e.g. FL2-E14"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #475569',
                    background: '#0f172a',
                    color: '#f8fafc',
                    textTransform: 'uppercase',
                    fontWeight: 700
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Lock Pose
                </button>
              </div>
              {shortCodeError && <div style={{ color: '#f87171', fontSize: '11px', marginTop: '4px' }}>{shortCodeError}</div>}
            </form>

            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginBottom: '6px' }}>
              DEPLOYED CAMPUS QR CHECKPOINTS (DOWNLOAD PNG TO SCAN ON PHONE OR CLICK TO LOCK):
            </div>
            <div style={{ display: 'grid', gap: '6px' }}>
              {osmPackage.anchors.map((anchor) => (
                <div
                  key={anchor.landmarkId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    gap: '10px'
                  }}
                >
                  <QRCodeSVG shortCode={anchor.shortCode} size={46} />

                  <button
                    onClick={() => {
                      applyAnchor(anchor, 'CHECKPOINT_SELECT');
                      setQrModalOpen(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#f8fafc',
                      textAlign: 'left',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '12px' }}>{anchor.label}</div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                      Floor L{anchor.level} • Code: <strong style={{ color: '#facc15' }}>{anchor.shortCode}</strong>
                    </div>
                  </button>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => downloadQRBadgeAsPNG(anchor)}
                      style={{
                        background: '#1e293b',
                        color: '#38bdf8',
                        border: '1px solid #38bdf8',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                      title="Download real ISO QR badge as PNG"
                    >
                      <Download size={12} />
                      PNG
                    </button>
                    <button
                      onClick={() => {
                        applyAnchor(anchor, 'QR_SCAN');
                        setQrModalOpen(false);
                      }}
                      style={{
                        background: '#1e3a8a',
                        color: '#93c5fd',
                        border: 'none',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <CheckCircle2 size={12} />
                      {anchor.shortCode}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;