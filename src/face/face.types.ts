/** A point in source-image pixels. */
export type Point = [x: number, y: number];

export interface DetectedFace {
  /** Top-left corner and size, in source-image pixels. */
  box: { x: number; y: number; width: number; height: number };
  /** Detector confidence, 0–1. */
  score: number;
  /**
   * Five points, in IMAGE order: the eye on the image's left, the eye on its
   * right, the nose tip, the mouth corner on the left, the one on the right.
   */
  landmarks: [Point, Point, Point, Point, Point];
}

export interface AnalysedFace extends DetectedFace {
  /**
   * Where the nose sits between the eyes, as a signed fraction of the eye
   * span. 0 is frontal. POSITIVE means the nose is towards the image's right,
   * which in an unmirrored camera frame is the person turning to THEIR left.
   * Monotonic in head yaw, but not degrees.
   */
  yaw: number;
  /** Distance between the eyes as a fraction of the image width: a size measure that barely changes as the head turns. */
  eyeSpan: number;
  /** Variance of the Laplacian over the aligned 112×112 crop. Higher is sharper. */
  sharpness: number;
  /** Mean luma of the aligned crop, 0–255. */
  brightness: number;
  /** Unit-length identity vector. Compare two with a dot product. */
  embedding: number[];
}

export interface FrameAnalysis {
  index: number;
  width: number;
  height: number;
  /** Every face found, so a caller can refuse a frame with a second person in it. */
  faceCount: number;
  /** The largest face, or null when there is none. */
  face: AnalysedFace | null;
}

/**
 * Detects, measures and embeds faces. Holds nothing between calls: frames
 * come in, numbers go out, and whoever called decides what they mean.
 */
export interface FaceEngine {
  /** Names the models, so a stored template can be tied to what produced it. */
  readonly model: string;
  analyse(frame: Buffer, index: number): Promise<FrameAnalysis>;
}
