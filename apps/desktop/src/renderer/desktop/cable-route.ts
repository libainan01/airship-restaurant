export interface CablePoint {
  readonly x: number;
  readonly y: number;
}

export const CABLE_CARGO_OFFSET: CablePoint = {
  x: -13,
  y: 46,
};

export const alignTrackPointToCargoTarget = (
  target: CablePoint,
): CablePoint => ({
  x: target.x - CABLE_CARGO_OFFSET.x,
  y: target.y - CABLE_CARGO_OFFSET.y,
});

interface CableSegment {
  readonly start: CablePoint;
  readonly end: CablePoint;
  readonly startDistance: number;
  readonly length: number;
  readonly tangent: CablePoint;
  readonly normal: CablePoint;
}

export interface CableRoute {
  readonly start: CablePoint;
  readonly end: CablePoint;
  readonly edgeX: number;
  readonly edgeStart: CablePoint;
  readonly edgeEnd: CablePoint;
  readonly points: readonly CablePoint[];
  readonly length: number;
  readonly segments: readonly CableSegment[];
}

const clampProgress = (progress: number): number =>
  Math.min(1, Math.max(0, progress));

const samePoint = (left: CablePoint, right: CablePoint): boolean =>
  left.x === right.x && left.y === right.y;

export const createEdgeCableRoute = (
  start: CablePoint,
  end: CablePoint,
  requestedEdgeX: number,
): CableRoute => {
  const edgeX = Math.max(requestedEdgeX, start.x, end.x);
  const candidates: readonly CablePoint[] = [
    { ...start },
    { x: edgeX, y: start.y },
    { x: edgeX, y: end.y },
    { ...end },
  ];
  const points = candidates.filter(
    (point, index) =>
      index === 0 || !samePoint(point, candidates[index - 1]!),
  );

  const segments: CableSegment[] = [];
  let accumulatedDistance = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentStart = points[index]!;
    const segmentEnd = points[index + 1]!;
    const deltaX = segmentEnd.x - segmentStart.x;
    const deltaY = segmentEnd.y - segmentStart.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length === 0) {
      continue;
    }

    const tangent = {
      x: deltaX / length,
      y: deltaY / length,
    };
    segments.push({
      start: segmentStart,
      end: segmentEnd,
      startDistance: accumulatedDistance,
      length,
      tangent,
      normal: {
        x: -tangent.y,
        y: tangent.x,
      },
    });
    accumulatedDistance += length;
  }

  const edgeStart = { x: edgeX, y: start.y };
  const edgeEnd = { x: edgeX, y: end.y };

  return {
    start: { ...start },
    end: { ...end },
    edgeX,
    points,
    edgeStart,
    edgeEnd,
    length: accumulatedDistance,
    segments,
  };
};

const findSegment = (
  route: CableRoute,
  progress: number,
): { readonly segment: CableSegment; readonly localProgress: number } | null => {
  if (route.segments.length === 0 || route.length === 0) {
    return null;
  }

  const distance = clampProgress(progress) * route.length;
  const segment =
    route.segments.find(
      (candidate) =>
        distance <= candidate.startDistance + candidate.length,
    ) ?? route.segments[route.segments.length - 1]!;
  const localProgress = Math.min(
    1,
    Math.max(0, (distance - segment.startDistance) / segment.length),
  );

  return { segment, localProgress };
};

export const sampleCableRoute = (
  route: CableRoute,
  progress: number,
  trackOffset = 0,
): CablePoint => {
  const match = findSegment(route, progress);
  if (match === null) {
    return { ...route.start };
  }

  const { segment, localProgress } = match;
  return {
    x:
      segment.start.x +
      (segment.end.x - segment.start.x) * localProgress +
      segment.normal.x * trackOffset,
    y:
      segment.start.y +
      (segment.end.y - segment.start.y) * localProgress +
      segment.normal.y * trackOffset,
  };
};

export const sampleCableTangent = (
  route: CableRoute,
  progress: number,
): CablePoint => {
  const match = findSegment(route, progress);
  return match === null ? { x: 1, y: 0 } : match.segment.tangent;
};
