import { assertAllergensPrintable } from "./menu-allergens";
import { MenuArtifactError, type NormalizedMenu } from "./menu-types";


export function assertNormalizedMenu(menu: NormalizedMenu) {
  if (!menu.siteKey?.trim()) throw new MenuArtifactError("MENU_SITE_REQUIRED", "A menu needs a destination site.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(menu.serviceDate)) throw new MenuArtifactError("MENU_DATE_INVALID", "A menu needs a YYYY-MM-DD service date.");
  if (menu.serviceTime !== undefined && !/^\d{2}:\d{2}$/.test(menu.serviceTime)) throw new MenuArtifactError("MENU_TIME_INVALID", "A menu service time must be HH:mm.");
  if (!menu.source?.id?.trim()) throw new MenuArtifactError("MENU_SOURCE_REQUIRED", "A menu needs a stable source identity.");
  const items = menu.sections.flatMap(section => section.items);
  if (!items.length) throw new MenuArtifactError("MENU_EMPTY", "There are no menu items to print.", 409);
  if (items.some(item => !item.name.trim())) throw new MenuArtifactError("MENU_ITEM_NAME_REQUIRED", "Every menu item needs a name.");
  // Defence in depth: adapters refuse these, and the renderer refuses them again.
  for (const item of items) assertAllergensPrintable(item);
}
