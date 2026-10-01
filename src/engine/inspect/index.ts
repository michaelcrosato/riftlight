/**
 * Asset inspection for agents (`npm run inspect`, docs/ENGINE.md "Tooling for agents"):
 * counts, bounds, joints, clips and warnings for any Object3D, a GPU-free turntable with
 * rig overlays, and diffs between two assets or two versions of one.
 */
export { DEFAULT_LIMITS, diffReports, inspectObject, jointsOf, type ClipInfo, type InspectLimits, type InspectOptions, type InspectReport, type MeshInfo, type ReportDiff } from './report';
export { INSPECT_BG, column, diffPanel, titleBar, fitScale, renderDiff, renderInspection, renderTurntable, renderView, reportLines, row, textBox, worldTriangles, type Line, type ViewOptions } from './render';
