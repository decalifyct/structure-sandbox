import { useEffect, useMemo, useRef, useState } from 'react';
import * as Matter from 'matter-js';

const MATERIALS = {
  wood: {
    name: 'Wood',
    density: 650, // kg/m^3
    tensile: 5e6,
    compressive: 12e6,
    flexural: 7e6,
    stiffness: 1.2e9,
    damping: 0.12,
    friction: 0.7,
  },
  steel: {
    name: 'Steel',
    density: 7850,
    tensile: 460e6,
    compressive: 460e6,
    flexural: 320e6,
    stiffness: 210e9,
    damping: 0.08,
    friction: 0.6,
  },
  aluminum: {
    name: 'Aluminum',
    density: 2700,
    tensile: 120e6,
    compressive: 140e6,
    flexural: 90e6,
    stiffness: 70e9,
    damping: 0.1,
    friction: 0.5,
  },
  concrete: {
    name: 'Concrete',
    density: 2400,
    tensile: 3e6,
    compressive: 30e6,
    flexural: 5e6,
    stiffness: 30e9,
    damping: 0.05,
    friction: 0.9,
  },
  rubber: {
    name: 'Rubber',
    density: 1100,
    tensile: 15e6,
    compressive: 20e6,
    flexural: 10e6,
    stiffness: 0.05e9,
    damping: 0.25,
    friction: 0.85,
  },
  plastic: {
    name: 'Plastic',
    density: 1200,
    tensile: 35e6,
    compressive: 45e6,
    flexural: 30e6,
    stiffness: 2.5e9,
    damping: 0.16,
    friction: 0.45,
  },
  rope: {
    name: 'Rope',
    density: 900,
    tensile: 25e6,
    compressive: 0.2e6,
    flexural: 1.5e6,
    stiffness: 0.18e9,
    damping: 0.2,
    friction: 0.8,
  },
  glass: {
    name: 'Glass',
    density: 2500,
    tensile: 35e6,
    compressive: 100e6,
    flexural: 40e6,
    stiffness: 70e9,
    damping: 0.12,
    friction: 0.4,
  },
} as const;

type MaterialKey = keyof typeof MATERIALS;

type Tool =
  | 'select'
  | 'beam'
  | 'rect'
  | 'circle'
  | 'connect'
  | 'erase'
  | 'test';

type ConnectionType = 'bolt' | 'weld' | 'glue' | 'rope' | 'hinge';

type ComponentKind = 'beam' | 'rect' | 'circle';

interface Component {
  id: string;
  kind: ComponentKind;
  materialKey: MaterialKey;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  thickness: number;
  angle: number;
  density: number;
  mass: number;
  label: string;
  bodyId?: string;
}

interface ConnectionDef {
  id: string;
  type: ConnectionType;
  a: string;
  b: string;
  maxTensile: number;
  maxShear: number;
  stiffness: number;
  rotationalLimit?: number;
  strengthOverride?: number;
  constraintId?: string;
  active: boolean;
  failureReason?: string;
}

interface FailureLogEntry {
  id: string;
  time: number;
  message: string;
  target: string;
  kind: 'component' | 'connection';
}

interface Point {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

const worldBounds = { width: 2200, height: 1400 };

const materialByKey = (key: MaterialKey) => MATERIALS[key];

const getComponentArea = (component: Component) => {
  if (component.kind === 'beam') return component.thickness * component.width;
  if (component.kind === 'rect') return component.width * component.height;
  return Math.PI * component.radius * component.radius;
};

const getComponentStrength = (component: Component) => {
  const material = materialByKey(component.materialKey);
  const area = getComponentArea(component);
  return {
    tensile: material.tensile * area,
    compressive: material.compressive * area,
    flexural: material.flexural * area,
  };
};

const baseConnectionConfig: Record<ConnectionType, { maxTensile: number; maxShear: number; stiffness: number }> = {
  bolt: { maxTensile: 12000, maxShear: 16000, stiffness: 0.8 },
  weld: { maxTensile: 24000, maxShear: 22000, stiffness: 1.2 },
  glue: { maxTensile: 7000, maxShear: 9000, stiffness: 0.4 },
  rope: { maxTensile: 8000, maxShear: 3000, stiffness: 0.25 },
  hinge: { maxTensile: 10000, maxShear: 11000, stiffness: 0.15 },
};

const makeHammerExample = (): Component[] => {
  return [
    {
      id: 'handle',
      kind: 'beam',
      materialKey: 'wood',
      x: 0,
      y: 0,
      width: 170,
      height: 18,
      radius: 0,
      thickness: 18,
      angle: 0,
      density: MATERIALS.wood.density,
      mass: 1.45,
      label: 'Wooden handle',
    },
    {
      id: 'head',
      kind: 'rect',
      materialKey: 'steel',
      x: 0,
      y: 0,
      width: 62,
      height: 52,
      radius: 0,
      thickness: 18,
      angle: 0,
      density: MATERIALS.steel.density,
      mass: 1.2,
      label: 'Steel head',
    },
  ];
};

const createBodyFromComponent = (component: Component, world: Matter.World) => {
  const material = materialByKey(component.materialKey);
  const x = component.x;
  const y = component.y;

  const body =
    component.kind === 'beam'
      ? Matter.Bodies.rectangle(x, y, component.width, component.thickness, {
          label: component.label,
          density: (material.density * component.width * component.thickness) / 1_000_000,
          friction: material.friction,
          restitution: 0.12,
          frictionAir: 0.02,
          chamfer: { radius: 1 },
        })
      : component.kind === 'rect'
        ? Matter.Bodies.rectangle(x, y, component.width, component.height, {
            label: component.label,
            density: (material.density * component.width * component.height) / 1_000_000,
            friction: material.friction,
            restitution: 0.1,
            frictionAir: 0.015,
            chamfer: { radius: 4 },
          })
        : Matter.Bodies.circle(x, y, component.radius, {
            label: component.label,
            density: (material.density * Math.PI * component.radius * component.radius) / 1_000_000,
            friction: material.friction,
            restitution: 0.15,
            frictionAir: 0.015,
          });

  Matter.Body.setAngle(body, component.angle);
  Matter.Body.setMass(body, component.mass || body.mass);
  body.plugin = { materialKey: component.materialKey, componentId: component.id };
  if (component.kind === 'beam') {
    body.render = { fillStyle: '#6ea8fe' };
  }
  Matter.World.add(world, body);
  return body;
};

const createConnectionConstraint = (
  world: Matter.World,
  aBody: Matter.Body,
  bBody: Matter.Body,
  connection: ConnectionDef,
): Matter.Constraint => {
  const bodyA = aBody;
  const bodyB = bBody;
  const config: Matter.ConstraintDefinition = {
    bodyA,
    bodyB,
    pointA: { x: 0, y: 0 },
    pointB: { x: 0, y: 0 },
    stiffness: connection.type === 'hinge' ? 0.15 : connection.type === 'rope' ? 0.18 : connection.type === 'glue' ? 0.55 : 0.8,
    damping: connection.type === 'rope' ? 0.1 : 0.04,
    length: connection.type === 'rope' ? 60 : 0,
    render: { visible: true },
  };

  const constraint = Matter.Constraint.create(config);
  Matter.World.add(world, constraint);
  return constraint;
};

const sampleProject = {
  name: 'Hammer test',
  gravity: 1,
  speed: 1,
  components: [
    { id: 'handle', kind: 'beam', materialKey: 'wood', x: 550, y: 400, width: 180, height: 18, radius: 0, thickness: 18, angle: 0, density: MATERIALS.wood.density, mass: 1.55, label: 'Wooden handle' },
    { id: 'head', kind: 'rect', materialKey: 'steel', x: 650, y: 357, width: 70, height: 70, radius: 0, thickness: 18, angle: 0, density: MATERIALS.steel.density, mass: 2.2, label: 'Steel head' },
    { id: 'target', kind: 'rect', materialKey: 'concrete', x: 1120, y: 760, width: 260, height: 30, radius: 0, thickness: 30, angle: 0, density: MATERIALS.concrete.density, mass: 18, label: 'Concrete block' },
  ],
  connections: [
    { id: 'conn-1', type: 'bolt', a: 'head', b: 'handle', maxTensile: 14000, maxShear: 17000, stiffness: 0.8, active: true },
  ],
};

const loadProject = () => {
  const saved = localStorage.getItem('structure-sandbox-project');
  return saved ? JSON.parse(saved) : sampleProject;
};

const ensureBodies = (components: Component[], world: Matter.World) => {
  const bodies: Record<string, Matter.Body> = {};
  components.forEach((component) => {
    const built = createBodyFromComponent(component, world);
    bodies[component.id] = built;
  });
  return bodies;
};

const formatPa = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 'n/a';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GPa`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} MPa`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} kPa`;
  return `${value.toFixed(0)} Pa`;
};

const formatMass = (value: number) => `${value.toFixed(2)} kg`;

const renderStatus = (value: number) => {
  if (value > 1.2) return 'safe';
  if (value > 0.9) return 'approaching limit';
  return 'failure likely';
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const worldRef = useRef<Matter.World | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialKey>('wood');
  const [components, setComponents] = useState<Component[]>(() => loadProject().components);
  const [connections, setConnections] = useState<ConnectionDef[]>(() => loadProject().connections);
  const [running, setRunning] = useState(false);
  const [gravity, setGravity] = useState<number>(() => loadProject().gravity || 1);
  const [speed, setSpeed] = useState<number>(() => loadProject().speed || 1);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [events, setEvents] = useState<FailureLogEntry[]>([
    { id: 'start', time: 0, message: 'Structure Sandbox ready. Select a tool and draw a component.', target: 'world', kind: 'component' },
  ]);
  const [showStress, setShowStress] = useState(true);
  const [launchVelocity, setLaunchVelocity] = useState(10);
  const [pausedReason, setPausedReason] = useState('');
  const dragRef = useRef<{ start: Point; current: Point; active: boolean; componentId: string | null } | null>(null);
  const drawPreviewRef = useRef<{ start: Point; end: Point; type: 'beam' | 'rect' | 'circle' | null } | null>(null);
  const connectionDraftRef = useRef<string | null>(null);
  const bodyMapRef = useRef<Record<string, Matter.Body>>({});
  const constraintMapRef = useRef<Record<string, Matter.Constraint>>({});

  const engine = engineRef.current ?? Matter.Engine.create({
    gravity: { x: 0, y: gravity },
    enableSleeping: false,
  });
  engineRef.current = engine;
  worldRef.current = engine.world;

  const selectedComponent = useMemo(
    () => components.find((item) => item.id === selectedComponentId) ?? null,
    [components, selectedComponentId],
  );

  const selectedConnection = useMemo(
    () => connections.find((item) => item.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId],
  );

  const rebuildWorld = () => {
    const world = worldRef.current;
    if (!world) return;
    Matter.Composite.clear(world, false, true);
    bodyMapRef.current = ensureBodies(components, world);
    connections.forEach((connection) => {
      const bodyA = bodyMapRef.current[connection.a];
      const bodyB = bodyMapRef.current[connection.b];
      if (!bodyA || !bodyB) return;
      const constraint = createConnectionConstraint(world, bodyA, bodyB, connection);
      constraintMapRef.current[connection.id] = constraint;
    });
    const ground = Matter.Bodies.rectangle(1000, 920, 1600, 30, {
      isStatic: true,
      label: 'Ground',
      friction: 0.9,
    });
    Matter.World.add(world, ground);
    const leftWall = Matter.Bodies.rectangle(-30, 460, 60, 900, { isStatic: true });
    const rightWall = Matter.Bodies.rectangle(1960, 460, 60, 900, { isStatic: true });
    Matter.World.add(world, [leftWall, rightWall]);
  };

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    Matter.Engine.update(engine, 1000 / 60);
    rebuildWorld();
  }, [components, connections, engine]);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.gravity.y = gravity;
  }, [gravity]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    const render = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#0f172a';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const gridSize = 32;
      context.strokeStyle = 'rgba(96,165,250,0.14)';
      context.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += gridSize) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
      }

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      context.fillStyle = '#e2e8f0';
      context.fillRect(0, 860, canvas.width, 120);

      const worldBodies = Matter.Composite.allBodies(engine.world);
      worldBodies.forEach((body) => {
        if (body.isStatic && body.label === 'Ground') {
          context.fillStyle = '#475569';
          context.fillRect(0, 880, canvas.width, 80);
          return;
        }

        const bodyInfo = body.plugin as { componentId?: string; materialKey?: MaterialKey } | undefined;
        const material = bodyInfo?.materialKey ? MATERIALS[bodyInfo.materialKey] : undefined;
        const x = body.position.x;
        const y = body.position.y;
        const width = body.bounds.max.x - body.bounds.min.x;
        const height = body.bounds.max.y - body.bounds.min.y;
        const stroke = bodyInfo && selectedComponentId === bodyInfo.componentId ? '#fef08a' : '#cbd5e1';

        context.save();
        context.translate(x, y);
        context.rotate(body.angle);
        context.beginPath();

        if (body.circleRadius) {
          context.arc(0, 0, body.circleRadius, 0, Math.PI * 2);
        } else {
          context.rect(-width / 2, -height / 2, width, height);
        }

        const fill = {
          wood: '#d97706',
          steel: '#94a3b8',
          aluminum: '#cbd5e1',
          concrete: '#64748b',
          rubber: '#ec4899',
          plastic: '#38bdf8',
          rope: '#a78bfa',
          glass: '#7dd3fc',
        }[bodyInfo?.materialKey ?? 'wood'];

        context.fillStyle = fill;
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = stroke;
        context.stroke();

        if (showStress && material) {
          const stress = Math.min(1, (Math.abs(body.velocity.x) + Math.abs(body.velocity.y)) / 18);
          context.fillStyle = `rgba(${Math.round(255 * (1 - stress))}, ${Math.round(180 * stress)}, ${Math.round(120 * stress)}, 0.45)`;
          context.fillRect(-width / 2, -height / 2, width, height);
        }

        context.restore();
      });

      Object.values(constraintMapRef.current).forEach((constraint) => {
        if (!constraint.bodyA || !constraint.bodyB) return;
        const a = constraint.bodyA.position;
        const b = constraint.bodyB.position;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.strokeStyle = selectedConnectionId ? '#fef08a' : '#7dd3fc';
        context.lineWidth = 2;
        context.stroke();
      });

      if (drawPreviewRef.current) {
        const { start, end, type } = drawPreviewRef.current;
        context.save();
        context.strokeStyle = '#f8fafc';
        context.setLineDash([10, 8]);
        context.beginPath();
        if (type === 'beam') {
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
        } else if (type === 'rect') {
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);
          context.rect(start.x, start.y, width, height);
        } else if (type === 'circle') {
          const radius = Math.hypot(end.x - start.x, end.y - start.y);
          context.arc(start.x, start.y, radius, 0, Math.PI * 2);
        }
        context.stroke();
        context.restore();
      }

      if (tool === 'select' && selectedComponent) {
        const body = bodyMapRef.current[selectedComponent.id];
        if (body) {
          context.beginPath();
          context.arc(body.position.x, body.position.y, 12, 0, Math.PI * 2);
          context.strokeStyle = '#f59e0b';
          context.lineWidth = 2;
          context.stroke();
        }
      }

      context.font = '12px monospace';
      context.fillStyle = '#cbd5e1';
      context.fillText(`Gravity: ${gravity.toFixed(2)} g`, 20, 30);
      context.fillText(`Speed: ${speed.toFixed(2)}x`, 20, 50);
      context.fillText(`Tool: ${tool}`, 20, 70);
      context.fillText('Build mode', 20, 90);
    };

    let animationFrame = 0;
    const tick = () => {
      if (running) {
        Matter.Engine.update(engine, 1000 / 60 * speed);
      }
      render();
      animationFrame = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(animationFrame);
  }, [gravity, running, speed, selectedComponentId, selectedConnectionId, showStress, tool, components, connections]);

  const saveProject = () => {
    const payload = { name: 'hammer', gravity, speed, components, connections };
    localStorage.setItem('structure-sandbox-project', JSON.stringify(payload));
    setEvents((prev) => [...prev, { id: makeId('save'), time: performance.now() / 1000, message: 'Project saved locally.', target: 'project', kind: 'component' }]);
  };

  const resetWorld = () => {
    const loaded = loadProject();
    setComponents(loaded.components);
    setConnections(loaded.connections);
    setGravity(loaded.gravity || 1);
    setSpeed(loaded.speed || 1);
    setSelectedComponentId(null);
    setSelectedConnectionId(null);
    setRunning(false);
    setEvents([{ id: makeId('reset'), time: 0, message: 'Simulation reset to original starting state.', target: 'world', kind: 'component' }]);
  };

  const addFailureEvent = (message: string, target: string, kind: 'component' | 'connection') => {
    setEvents((prev) => [
      ...prev,
      {
        id: makeId('event'),
        time: performance.now() / 1000,
        message,
        target,
        kind,
      },
    ].slice(-10));
  };

  const removeComponent = (id: string) => {
    const body = bodyMapRef.current[id];
    if (body && worldRef.current) Matter.Composite.remove(worldRef.current, body);
    setComponents((prev) => prev.filter((item) => item.id !== id));
    if (selectedComponentId === id) setSelectedComponentId(null);
  };

  const ensureComponentMass = (component: Component) => {
    const material = MATERIALS[component.materialKey];
    const area = getComponentArea(component);
    const thickness = component.thickness || 0.12;
    const volume = area * thickness;
    const mass = (material.density * volume) / 1_000_000;
    return { ...component, mass: Number(mass.toFixed(3)) };
  };

  useEffect(() => {
    setComponents((prev) => prev.map((item) => ensureComponentMass(item)));
  }, []);

  useEffect(() => {
    const runFailureChecks = () => {
      const bodyEntries = Object.entries(bodyMapRef.current);
      if (!bodyEntries.length) return;

      bodyEntries.forEach(([id, body]) => {
        const component = components.find((item) => item.id === id);
        if (!component) return;
        const material = materialByKey(component.materialKey);
        const stress = (Math.abs(body.force.x) + Math.abs(body.force.y)) / Math.max(1, getComponentArea(component));

        const threshold = material.tensile * 0.33;
        if (stress > threshold && Math.abs(body.velocity.x) + Math.abs(body.velocity.y) > 6) {
          addFailureEvent(`${component.label} exceeded estimated tensile stress and fractured.`, component.label, 'component');
          removeComponent(id);
        }
      });

      connections.forEach((conn) => {
        const bodyA = bodyMapRef.current[conn.a];
        const bodyB = bodyMapRef.current[conn.b];
        if (!bodyA || !bodyB || !conn.active) return;
        const constraint = constraintMapRef.current[conn.id];
        if (!constraint) return;
        const dx = bodyB.position.x - bodyA.position.x;
        const dy = bodyB.position.y - bodyA.position.y;
        const distance = Math.hypot(dx, dy) || 1;
        const load = Math.abs(distance - (constraint.length || 0)) * (conn.stiffness || 1) * 6000;
        if (conn.type === 'rope') {
          if (load > conn.maxTensile && distance > (constraint.length || 60)) {
            conn.active = false;
            addFailureEvent(`Rope connection failed under ${load.toFixed(0)} N > ${conn.maxTensile} N.`, conn.id, 'connection');
          }
          return;
        }
        if (conn.type === 'hinge') {
          if (load > conn.maxShear) {
            conn.active = false;
            addFailureEvent(`Hinge connection slipped under ${(load / 1000).toFixed(2)} kN.`, conn.id, 'connection');
          }
          return;
        }
        if (load > Math.max(conn.maxTensile, conn.maxShear)) {
          conn.active = false;
          addFailureEvent(`${conn.type} connection failed under ${(load / 1000).toFixed(2)} kN.`, conn.id, 'connection');
        }
      });
    };

    if (!running) return;
    const interval = setInterval(runFailureChecks, 100);
    return () => clearInterval(interval);
  }, [running, components, connections]);

  const beginDraw = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (tool === 'beam' || tool === 'rect' || tool === 'circle') {
      drawPreviewRef.current = { start: { x, y }, end: { x, y }, type: tool === 'beam' ? 'beam' : tool === 'rect' ? 'rect' : 'circle' };
      return;
    }

    if (tool === 'connect') {
      if (!connectionDraftRef.current) {
        const select = findComponentAtPoint(x, y);
        if (select) {
          connectionDraftRef.current = select;
          setSelectedComponentId(select);
          setPausedReason('First connection point selected. Click second component to complete joint.');
        }
        return;
      }

      const second = findComponentAtPoint(x, y);
      if (!second || second === connectionDraftRef.current) return;
      const connectionType: ConnectionType = 'bolt';
      const newConnection: ConnectionDef = {
        id: makeId('connection'),
        type: connectionType,
        a: connectionDraftRef.current,
        b: second,
        maxTensile: baseConnectionConfig[connectionType].maxTensile,
        maxShear: baseConnectionConfig[connectionType].maxShear,
        stiffness: baseConnectionConfig[connectionType].stiffness,
        active: true,
      };
      setConnections((prev) => [...prev, newConnection]);
      connectionDraftRef.current = null;
      addFailureEvent('New connection created.', newConnection.id, 'connection');
      return;
    }

    const hit = findComponentAtPoint(x, y);
    if (hit) {
      setSelectedComponentId(hit);
      setSelectedConnectionId(null);
      if (tool === 'erase') {
        removeComponent(hit);
        return;
      }
      if (tool === 'select' && !running) {
        dragRef.current = { start: { x, y }, current: { x, y }, active: true, componentId: hit };
      }
    }
  };

  const onMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (drawPreviewRef.current) {
      drawPreviewRef.current.end = { x, y };
      return;
    }

    if (dragRef.current?.active && dragRef.current.componentId) {
      const body = bodyMapRef.current[dragRef.current.componentId];
      if (body) {
        const dx = x - dragRef.current.start.x;
        const dy = y - dragRef.current.start.y;
        Matter.Body.translate(body, { x: dx, y: dy });
        dragRef.current.start.x = x;
        dragRef.current.start.y = y;
      }
    }
  };

  const endDraw = () => {
    if (!drawPreviewRef.current) return;
    const { start, end, type } = drawPreviewRef.current;
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    const next: Component = {
      id: makeId('component'),
      kind: type,
      materialKey: selectedMaterial,
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      width: type === 'beam' ? Math.max(80, Math.hypot(end.x - start.x, end.y - start.y)) : Math.max(30, width),
      height: type === 'beam' ? 18 : Math.max(30, height),
      radius: type === 'circle' ? Math.max(20, Math.hypot(end.x - start.x, end.y - start.y) / 2) : 0,
      thickness: 18,
      angle: type === 'beam' ? Math.atan2(end.y - start.y, end.x - start.x) : 0,
      density: MATERIALS[selectedMaterial].density,
      mass: 0,
      label: `${MATERIALS[selectedMaterial].name} ${type}`,
    };

    const mass = (MATERIALS[selectedMaterial].density * getComponentArea(next)) / 1000000;
    next.mass = Number(mass.toFixed(3));
    setComponents((prev) => [...prev, next]);
    setSelectedComponentId(next.id);
    drawPreviewRef.current = null;
  };

  const findComponentAtPoint = (x: number, y: number) => {
    let hit: string | null = null;
    let minDist = Infinity;
    components.forEach((component) => {
      const body = bodyMapRef.current[component.id];
      if (!body) return;
      const dist = Math.hypot(body.position.x - x, body.position.y - y);
      if (dist < 30 && dist < minDist) {
        hit = component.id;
        minDist = dist;
      }
    });
    return hit;
  };

  const applyLaunch = () => {
    const selected = selectedComponentId ? bodyMapRef.current[selectedComponentId] : null;
    if (!selected) return;
    Matter.Body.setVelocity(selected, { x: launchVelocity, y: -1 });
    Matter.Body.setAngularVelocity(selected, 0.2);
    addFailureEvent(`Impact launch applied at ${launchVelocity.toFixed(1)} m/s.`, selected.label, 'component');
  };

  const resetToHammer = () => {
    const example = sampleProject;
    setComponents(example.components);
    setConnections(example.connections);
    setGravity(example.gravity);
    setSpeed(example.speed);
    setSelectedComponentId('head');
    setRunning(false);
    setEvents([{ id: makeId('intro'), time: 0, message: 'Hammer starter project restored.', target: 'project', kind: 'component' }]);
  };

  const exportProject = () => {
    const payload = JSON.stringify({ gravity, speed, components, connections }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'structure-sandbox-project.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = JSON.parse(text);
      setComponents(parsed.components);
      setConnections(parsed.connections);
      setGravity(parsed.gravity || 1);
      setSpeed(parsed.speed || 1);
      setEvents([{ id: makeId('import'), time: 0, message: 'Project imported.', target: 'project', kind: 'component' }]);
    };
    input.click();
  };

  const currentStats = selectedComponent
    ? (() => {
        const area = getComponentArea(selectedComponent);
        const strength = getComponentStrength(selectedComponent);
        const material = MATERIALS[selectedComponent.materialKey];
        const safety = selectedComponent.mass > 0 ? (strength.tensile / Math.max(1, selectedComponent.mass * 6000)) : 1;
        return {
          area,
          safety,
          strength,
          material,
        };
      })()
    : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-icon">S</div>
          <div>
            <div className="eyebrow">Engineering lab</div>
            <strong>Structure Sandbox</strong>
          </div>
        </div>

        <div className="toolbar-controls">
          <button onClick={() => setRunning((v) => !v)}>{running ? 'Pause' : 'Play'}</button>
          <button onClick={resetWorld}>Reset</button>
          <button onClick={() => setRunning(false)}>Build</button>
          <label>
            Speed
            <input type="range" min="0.2" max="2.5" step="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />
          </label>
          <label>
            Gravity
            <input type="range" min="0" max="2" step="0.1" value={gravity} onChange={(e) => setGravity(parseFloat(e.target.value))} />
          </label>
          <button onClick={() => setGravity(0)}>Zero g</button>
          <button onClick={saveProject}>Save</button>
          <button onClick={importProject}>Load</button>
          <button onClick={exportProject}>Export</button>
          <button onClick={resetToHammer}>Hammer demo</button>
        </div>
      </header>

      <div className="content-shell">
        <aside className="sidebar left-panel">
          <h3>Tools</h3>
          <div className="tool-grid">
            {(['select', 'beam', 'rect', 'circle', 'connect', 'erase', 'test'] as Tool[]).map((mode) => (
              <button key={mode} className={mode === tool ? 'active' : ''} onClick={() => setTool(mode)}>
                {mode}
              </button>
            ))}
          </div>

          <h3>Material</h3>
          <div className="material-grid">
            {(Object.keys(MATERIALS) as MaterialKey[]).map((key) => (
              <button key={key} className={selectedMaterial === key ? 'active material-button' : 'material-button'} onClick={() => setSelectedMaterial(key)}>
                {MATERIALS[key].name}
              </button>
            ))}
          </div>

          <div className="helper-card">
            <strong>Build flow</strong>
            <ol>
              <li>Select material.</li>
              <li>Draw beam, rect, or circle.</li>
              <li>Use connect tool to join parts.</li>
              <li>Run simulation and inspect the log.</li>
            </ol>
          </div>
        </aside>

        <main className="stage-wrap">
          <canvas
            ref={canvasRef}
            width={1100}
            height={900}
            onMouseDown={beginDraw}
            onMouseMove={onMouseMove}
            onMouseUp={endDraw}
            onMouseLeave={() => {
              drawPreviewRef.current = null;
              dragRef.current = null;
            }}
          />
        </main>

        <aside className="sidebar right-panel">
          <h3>Inspector</h3>
          {selectedComponent ? (
            <div className="inspector-panel">
              <div className="inspector-header">
                <strong>{selectedComponent.label}</strong>
                <span>{MATERIALS[selectedComponent.materialKey].name}</span>
              </div>

              <div className="stats-grid">
                <div><label>Mass</label><span>{formatMass(selectedComponent.mass)}</span></div>
                <div><label>Area</label><span>{currentStats?.area.toFixed(0)} mm²</span></div>
                <div><label>Tensile</label><span>{formatPa(MATERIALS[selectedComponent.materialKey].tensile)}</span></div>
                <div><label>Flexural</label><span>{formatPa(MATERIALS[selectedComponent.materialKey].flexural)}</span></div>
                <div><label>Density</label><span>{MATERIALS[selectedComponent.materialKey].density} kg/m³</span></div>
                <div><label>Safety</label><span>{renderStatus(currentStats?.safety ?? 1)}</span></div>
              </div>
            </div>
          ) : (
            <p>Select a component to inspect properties.</p>
          )}

          {selectedConnection ? (
            <div className="inspector-panel connection-panel">
              <strong>Joint: {selectedConnection.type}</strong>
              <div className="stats-grid">
                <div><label>Tensile</label><span>{selectedConnection.maxTensile} N</span></div>
                <div><label>Shear</label><span>{selectedConnection.maxShear} N</span></div>
                <div><label>Stiffness</label><span>{selectedConnection.stiffness.toFixed(2)}</span></div>
              </div>
            </div>
          ) : null}

          <div className="test-panel">
            <h4>Impact test</h4>
            <label>
              Launch velocity (m/s)
              <input type="range" min="2" max="30" step="1" value={launchVelocity} onChange={(e) => setLaunchVelocity(Number(e.target.value))} />
            </label>
            <div className="launch-readout">{launchVelocity.toFixed(1)} m/s</div>
            <button onClick={applyLaunch}>Apply launch</button>
          </div>

          <div className="stress-toggle">
            <label>
              <input type="checkbox" checked={showStress} onChange={(e) => setShowStress(e.target.checked)} />
              Stress overlay
            </label>
          </div>
        </aside>
      </div>

      <footer className="bottom-panel">
        <div className="log-header">
          <strong>Failure log</strong>
          <span>{pausedReason || 'Ready for test'}</span>
        </div>
        <div className="log-list">
          {events.slice().reverse().map((event) => (
            <div key={event.id} className="log-item" onClick={() => setSelectedComponentId(event.target)}>
              <span>{event.time.toFixed(2)} s</span>
              <strong>{event.kind}</strong>
              <p>{event.message}</p>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}

export default App;
