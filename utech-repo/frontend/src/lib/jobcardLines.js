/**
 * Which job-card lines count, and which ones get sent.
 *
 * The job-card form lets someone add a line row and then leave it. Two
 * questions follow from that, and the form used to answer them with one
 * predicate that had its quantity clause inverted:
 *
 *   const lineInPlay = (l) =>
 *     !!(l.itemId || l.itemName.trim() || String(l.qty ?? '').trim() === '' || …)
 *                                                                  ^^^^
 * It read "this line counts if its quantity is EMPTY", which is the opposite of
 * what was meant, and it was used to decide what to VALIDATE while the payload
 * sent every row regardless. So:
 *
 *   - a row with a quantity and nothing else skipped validation and was sent.
 *     A quantity of 0 (or a typo like "1o") then failed the API's own schema and
 *     the save came back 400 — correct of the API, useless to the user, who had
 *     no highlighted field to fix.
 *   - a row the user had not touched at all was treated as in play, so saving
 *     demanded a quantity for a line they considered empty.
 *
 * These two functions answer the questions separately and say what they mean.
 */

/** Has anyone put anything in this row? A typed quantity counts. */
export function lineHasContent(line = {}) {
  return !!(
    line.itemId
    || String(line.itemName ?? '').trim()
    || String(line.qty ?? '').trim()
    || String(line.uomCode ?? '').trim()
    || String(line.notes ?? '').trim()
  );
}

/**
 * The rows to send on save.
 *
 * An untouched new row is dropped — adding a row by accident must not block the
 * save, and an empty row is not a line. A row that is already saved (it has an
 * `id`) is always kept: the update applies the array as the complete list of
 * lines, so leaving one out deletes it.
 */
export function linesToSave(lines = []) {
  return lines.filter((line) => line.id != null || lineHasContent(line));
}
