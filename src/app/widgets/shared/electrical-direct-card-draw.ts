import { select, type Selection } from 'd3-selection';
import type { IElectricalTopologySnapshotCore } from '../../core/contracts/electrical-topology-card.contract';
import {
  ELECTRICAL_DIRECT_CARD_COMPACT_LAYOUT,
  ELECTRICAL_DIRECT_CARD_FULL_LAYOUT,
  ELECTRICAL_DIRECT_CARD_GAP,
  ELECTRICAL_DIRECT_CARD_HEIGHT,
  ELECTRICAL_DIRECT_CARD_VIEWBOX_WIDTH,
  ELECTRICAL_DIRECT_COMPACT_CARD_HEIGHT
} from './electrical-card-layout.constants';

/**
 * The per-card display fields the shared direct-card draw reads. The trio's own
 * DisplayModel types (alternator, inverter, ac) are structural supersets, so
 * each assigns to `Record<string, DirectCardDisplayModel>` without an adapter.
 */
export interface DirectCardDisplayModel {
  id: string;
  titleText: string;
  modeText: string;
  busText: string;
  metricsLineOne: string;
  metricsLineTwo: string;
  stateBarColor: string;
  titleTextColor: string;
  metaTextColor: string;
  primaryMetricsTextColor: string;
  secondaryMetricsTextColor: string;
}

export interface DirectCardDrawDescriptor<TEntity extends IElectricalTopologySnapshotCore> {
  /** CSS class prefix and element-class stem: `alternator` | `inverter` | `ac`. */
  classPrefix: string;
  /** Alternator and inverter render a bordered card background; ac omits it. */
  includeCardBg: boolean;
  /** Title text used when no display model exists for a card's key. */
  titleFallback: (entity: TEntity) => string;
}

export interface DirectCardDrawParams<TEntity extends IElectricalTopologySnapshotCore> {
  svg: Selection<SVGSVGElement, unknown, null, undefined>;
  layer: Selection<SVGGElement, unknown, null, undefined>;
  entities: TEntity[];
  displayModels: Record<string, DirectCardDisplayModel>;
  widgetColors: { dim: string };
  compact: boolean;
  descriptor: DirectCardDrawDescriptor<TEntity>;
}

interface DirectCard<TEntity> {
  key: string;
  entity: TEntity;
  y: number;
}

/**
 * Select the direct-card `<svg>`, seed the shared viewBox/role/aria-label, and
 * append the stacked-card layer group. Reads the layout constants at call time
 * so bundler init order never leaves the geometry undefined.
 */
export function initDirectCardSvg(
  element: SVGSVGElement,
  opts: { ariaLabel: string; classPrefix: string }
): {
  svg: Selection<SVGSVGElement, unknown, null, undefined>;
  layer: Selection<SVGGElement, unknown, null, undefined>;
} {
  const svg = select(element);
  svg
    .attr('viewBox', `0 0 ${ELECTRICAL_DIRECT_CARD_VIEWBOX_WIDTH} ${ELECTRICAL_DIRECT_CARD_HEIGHT}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', opts.ariaLabel);
  const layer = svg.append('g').attr('class', `${opts.classPrefix}-layer`);
  return { svg, layer };
}

/**
 * Shared stacked-card d3 draw for the direct electrical trio (alternator,
 * inverter, ac). Behaviourally and pixel-identical to the per-widget render it
 * replaces; the only structural axis is `includeCardBg` (ac has no card
 * background). Layout constants are read here, at draw time.
 */
export function drawDirectCards<TEntity extends IElectricalTopologySnapshotCore>(
  params: DirectCardDrawParams<TEntity>
): void {
  const { svg, layer, entities, displayModels, widgetColors, compact, descriptor } = params;
  const { classPrefix, includeCardBg, titleFallback } = descriptor;

  const layout = compact ? ELECTRICAL_DIRECT_CARD_COMPACT_LAYOUT : ELECTRICAL_DIRECT_CARD_FULL_LAYOUT;
  const cardHeight = compact ? ELECTRICAL_DIRECT_COMPACT_CARD_HEIGHT : ELECTRICAL_DIRECT_CARD_HEIGHT;
  const cards: DirectCard<TEntity>[] = entities.map((entity, index) => ({
    key: entity.deviceKey ?? entity.id,
    entity,
    y: index * (cardHeight + ELECTRICAL_DIRECT_CARD_GAP)
  }));

  const contentHeight = cards.length ? cards[cards.length - 1].y + cardHeight : cardHeight;
  svg.attr('viewBox', `0 0 ${ELECTRICAL_DIRECT_CARD_VIEWBOX_WIDTH} ${contentHeight}`);

  const selection = layer
    .selectAll<SVGGElement, DirectCard<TEntity>>(`g.${classPrefix}-card`)
    .data(cards, item => item.key);

  const enter = selection.enter().append('g').attr('class', `${classPrefix}-card`);
  if (includeCardBg) {
    enter.append('rect').attr('class', `${classPrefix}-card-bg`);
  }
  enter.append('rect').attr('class', `${classPrefix}-state-bar`);
  enter.append('text').attr('class', `${classPrefix}-title`);
  enter.append('text').attr('class', `${classPrefix}-id`);
  enter.append('text').attr('class', `${classPrefix}-mode`);
  enter.append('text').attr('class', `${classPrefix}-bus`);
  enter.append('text').attr('class', `${classPrefix}-metrics-1`);
  enter.append('text').attr('class', `${classPrefix}-metrics-2`);

  const merged = enter.merge(selection as Selection<SVGGElement, DirectCard<TEntity>, SVGGElement, unknown>);

  merged.attr('transform', item => `translate(0, ${item.y})`);

  if (includeCardBg) {
    merged.select(`rect.${classPrefix}-card-bg`)
      .attr('x', 0.5)
      .attr('y', 0.5)
      .attr('rx', layout.cardCornerRadius)
      .attr('ry', layout.cardCornerRadius)
      .attr('width', ELECTRICAL_DIRECT_CARD_VIEWBOX_WIDTH - 1)
      .attr('height', cardHeight - 1)
      .attr('stroke', 'var(--mat-sys-outline-variant)')
      .attr('stroke-width', 0.5)
      .attr('fill', 'none');
  }

  merged.select(`rect.${classPrefix}-state-bar`)
    .attr('x', 1.5)
    .attr('y', 1.5)
    .attr('rx', layout.stateBarCornerRadius)
    .attr('ry', layout.stateBarCornerRadius)
    .attr('width', 3)
    .attr('height', cardHeight - 3)
    .attr('fill', item => displayModels[item.key]?.stateBarColor ?? widgetColors.dim);

  if (entities.length > 1) {
    merged.select(`text.${classPrefix}-title`)
      .attr('x', layout.titleX)
      .attr('y', layout.titleY)
      .attr('font-size', layout.titleFontSize)
      .attr('fill', item => displayModels[item.key]?.titleTextColor ?? 'var(--skip-contrast-color)')
      .text(item => displayModels[item.key]?.titleText ?? titleFallback(item.entity));
  } else {
    merged.select(`text.${classPrefix}-title`).text('');
  }

  merged.select(`text.${classPrefix}-id`)
    .attr('x', layout.idX)
    .attr('y', layout.idY)
    .attr('text-anchor', 'end')
    .attr('font-size', layout.idFontSize)
    .attr('fill', 'var(--skip-contrast-dim-color)')
    .text(item => item.entity.id);

  merged.select(`text.${classPrefix}-mode`)
    .attr('x', layout.metaLeftX)
    .attr('y', layout.metaY)
    .attr('font-size', layout.metaFontSize)
    .attr('opacity', 0.8)
    .attr('fill', item => displayModels[item.key]?.metaTextColor ?? 'var(--skip-contrast-dim-color)')
    .text(item => displayModels[item.key]?.modeText ?? '');

  merged.select(`text.${classPrefix}-bus`)
    .attr('x', layout.metaRightX)
    .attr('y', layout.metaY)
    .attr('text-anchor', 'end')
    .attr('font-size', layout.metaFontSize)
    .attr('opacity', 0.8)
    .attr('fill', item => displayModels[item.key]?.metaTextColor ?? 'var(--skip-contrast-dim-color)')
    .text(item => displayModels[item.key]?.busText ?? '');

  merged.select(`text.${classPrefix}-metrics-1`)
    .attr('x', layout.lineOneX)
    .attr('y', layout.lineOneY)
    .attr('font-size', layout.lineOneFontSize)
    .attr('fill', item => displayModels[item.key]?.primaryMetricsTextColor ?? 'var(--skip-contrast-color)')
    .text(item => displayModels[item.key]?.metricsLineOne ?? '');

  merged.select(`text.${classPrefix}-metrics-2`)
    .attr('x', layout.lineTwoX)
    .attr('y', layout.lineTwoY)
    .attr('font-size', layout.lineTwoFontSize)
    .attr('opacity', 0.85)
    .attr('fill', item => displayModels[item.key]?.secondaryMetricsTextColor ?? 'var(--skip-contrast-color)')
    .text(item => displayModels[item.key]?.metricsLineTwo ?? '');

  selection.exit().remove();
}
