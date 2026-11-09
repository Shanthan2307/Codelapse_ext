/**
 * The CodeLapse replay UI, shared by the extension's report and the instructor
 * site. Render it inside an element with the class `codelapse-replay` and
 * import `@codelapse/replay/styles.css` once; every style is scoped to that
 * class, so it never touches the page around it.
 */
export { TimelapsePlayer } from './components/TimelapsePlayer';
export type { TimelapsePlayerProps } from './components/TimelapsePlayer';
export { MetricsRow } from './components/MetricsRow';
export { ActivityChart } from './components/ActivityChart';
export { FileJourney } from './components/FileJourney';
export * from '../model';
