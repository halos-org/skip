import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Filler,
  Legend,
  Tooltip,
  Title,
  SubTitle
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import ChartStreaming from '@aziham/chartjs-plugin-streaming';

let registered = false;

/**
 * Registers only the Chart.js building blocks Skip actually renders — line charts on
 * linear and time scales — plus the annotation and streaming plugins, exactly once for
 * the whole app. Chart consumers call this at module load instead of each running their
 * own `Chart.register`, so a chart is never created before its controller/scale/plugin
 * set is present. Registering the explicit union rather than every registerable lets the
 * bundler drop the unused controllers/scales on this Pi-class target. The `realtime`
 * scale used by the live-tail charts is contributed by the streaming plugin registration.
 * It also sets the app-wide line-join default to round here, once alongside registration,
 * so thick chart lines never render the miter spikes that flicker as a chart scrolls.
 */
export function registerChartComponents(): void {
  if (registered) {
    return;
  }
  registered = true;
  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    TimeScale,
    Filler,
    Legend,
    Tooltip,
    Title,
    SubTitle,
    annotationPlugin,
    ChartStreaming
  );

  // Round line joins instead of Chart.js's default miter. At a sharp corner a miter juts to a
  // point until its length crosses the canvas miterLimit, at which point the browser flips it to
  // a bevel. As a realtime chart scrolls, each vertex's sub-pixel geometry shifts and vertices
  // near that threshold flicker spike<->bevel frame to frame — most visibly on narrow viewports,
  // where points pack into fewer pixels and corners are sharpest. Round joins have no miter point,
  // so nothing spikes and nothing flips.
  Chart.defaults.elements.line.borderJoinStyle = 'round';
}
