import { Chart, registerables } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import ChartStreaming from '@aziham/chartjs-plugin-streaming';

let registered = false;

/**
 * Registers every Chart.js building block plus the annotation and streaming
 * plugins exactly once for the whole app. Chart consumers call this at module
 * load instead of each running their own `Chart.register`, so a chart is never
 * created before its controller/scale/plugin set is present.
 */
export function registerChartComponents(): void {
  if (registered) {
    return;
  }
  registered = true;
  Chart.register(...registerables, annotationPlugin, ChartStreaming);
}
