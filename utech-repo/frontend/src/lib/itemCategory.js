/**
 * Which item category a calculated shape belongs to.
 *
 * The categories this plant keeps are the shapes it buys — Round Bar & Hex,
 * Pipe, Plate, Flange. So when someone defines an item through the material
 * size calculator, the category they would pick by hand is already known from
 * the shape they chose. Filling it saves a field and, more usefully, keeps the
 * classification consistent: a category the Items filter and the stock reports
 * can be trusted to group by.
 *
 * Two rules it must never break:
 *  - it only ever fills an EMPTY category. A category someone chose is theirs.
 *  - it only ever picks a category that exists on this site. The names below
 *    are candidates to look for, not categories to create, so a plant that
 *    calls its plate category something else simply gets nothing here instead
 *    of a wrong answer.
 *
 * Shapes with no obvious home (flat bar, angle, beam, channel, T profile,
 * square bar and square tube) are deliberately absent. A square tube is not a
 * pipe to a storekeeper, and guessing would put stock in the wrong place.
 */

// shape id -> the category names worth looking for, best match first
const CANDIDATES = {
  roundbar: ['Round Bar & Hex', 'Round Bar', 'Round'],
  hexagon: ['Round Bar & Hex', 'Hex', 'Hexagon'],
  pipe: ['Pipe', 'Pipes', 'Tube'],
  sheet: ['Plate', 'Sheet', 'Plates'],
};

const normalise = (text) => String(text ?? '').trim().toLowerCase();

/**
 * @param {string} shapeId   a calculator shape, e.g. 'roundbar'
 * @param {Array<{id:number,name:string}>} categories  the site's own list
 * @returns {number|null} the category id to use, or null to leave it alone
 */
export function categoryIdForShape(shapeId, categories = []) {
  const names = CANDIDATES[normalise(shapeId)];
  if (!names || !Array.isArray(categories)) return null;
  for (const wanted of names) {
    const found = categories.find((c) => normalise(c.name) === normalise(wanted));
    if (found) return found.id;
  }
  return null;
}

/** The name, for showing what was chosen. */
export function categoryNameById(categoryId, categories = []) {
  const found = (categories || []).find((c) => String(c.id) === String(categoryId));
  return found ? found.name : null;
}
