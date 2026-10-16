import type { Project } from './domain';

export interface AdvertisingProduct {
  id: string;
  name: string;
  platform: string;
  accountId: string;
  active: boolean;
  access?: {appId: string; secretConfigured: boolean; authCodeConfigured?: boolean};
}

export interface LiveRoom {
  openedOn?: string;
  id: string;
  name: string;
  platformAccountId: string;
  active: boolean;
  productId: string;
}

/** Stable legacy IDs preserve record identity. Extra source accounts become independent rooms;
 * existing live records belong only to the primary room and must never be copied to each room. */
export function splitLegacyProjects(projects: Project[]): {products: AdvertisingProduct[]; rooms: LiveRoom[]} {
  const products = projects.map(project => ({
    id: `product-${project.id}`, name: project.name, platform: project.platform,
    accountId: project.account, active: project.active,
    ...(project.access ? {access: {...project.access}} : {}),
  }));
  const rooms = projects.flatMap(project => (project.liveAccountIds.length ? project.liveAccountIds : ['']).map((accountId, index) => ({
    id: index === 0 ? project.id : `${project.id}-room-${index + 1}`,
    name: `${project.name}直播间${index === 0 ? '' : ` ${index + 1}`}`,
    platformAccountId: accountId, active: project.active, productId: `product-${project.id}`,
  })));
  return {products, rooms};
}
