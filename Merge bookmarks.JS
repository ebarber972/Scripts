// ============================================================
// Chrome Bookmark Merger + Deduplicator
// Moves everything from your "Imported" folder into the
// Bookmarks Bar, preserving folder structure, skipping dupes.
//
// HOW TO RUN:
//   1. Open Chrome and go to: chrome://bookmarks/
//   2. Press F12 to open DevTools
//   3. Click the "Console" tab
//   4. Paste this entire script and press Enter
// ============================================================

(async function () {
  // Safety check — must be run in a privileged extension context
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    console.error(
      '❌ chrome.bookmarks is not available here.\n' +
      'Make sure you are on chrome://bookmarks/ and run this in that page\'s DevTools console.'
    );
    return;
  }

  // ── 1. Load the full bookmark tree ──────────────────────────
  const tree = await new Promise(r => chrome.bookmarks.getTree(r));
  const root = tree[0];
  const bookmarksBar = root.children.find(n => n.id === '1');

  if (!bookmarksBar) {
    console.error('❌ Could not find Bookmarks Bar (id=1). Aborting.');
    return;
  }

  // ── 2. Find the imported folder anywhere in the tree ────────
  function findNode(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.children || []) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }

  const importedFolder = findNode(root, n =>
    !n.url &&
    Array.isArray(n.children) &&
    !['0', '1', '2', '3'].includes(n.id) &&
    (n.title.toLowerCase().includes('imported') ||
     n.title.toLowerCase().includes('edge'))
  );

  if (!importedFolder) {
    console.warn('⚠️  No "Imported" or "Edge" folder found. Listing all top-level folders so you can verify:');
    (bookmarksBar.children || [])
      .filter(c => !c.url)
      .forEach(c => console.log(`  • "${c.title}" (id: ${c.id})`));
    console.warn('If your folder has a different name, update the search condition in the script.');
    return;
  }

  function countBookmarks(node) {
    if (node.url) return 1;
    return (node.children || []).reduce((s, c) => s + countBookmarks(c), 0);
  }

  console.log(`\n📂 Found: "${importedFolder.title}" — ${countBookmarks(importedFolder)} bookmarks to process`);

  // ── 3. Collect all URLs already in Bookmarks Bar ────────────
  const existingUrls = new Set();
  function collectUrls(node) {
    if (node.url) existingUrls.add(node.url);
    (node.children || []).forEach(collectUrls);
  }
  collectUrls(bookmarksBar);
  console.log(`📊 Bookmarks Bar currently has ${existingUrls.size} unique URLs\n`);

  // ── 4. Recursive merge ───────────────────────────────────────
  let moved = 0;
  let duplicates = 0;

  async function processFolder(sourceItems, targetParentId) {
    // Get current subfolders in the target (live, not snapshot)
    const targetKids = await new Promise(r => chrome.bookmarks.getChildren(targetParentId, r));
    const subFolderMap = {};
    targetKids.filter(k => !k.url).forEach(k => {
      subFolderMap[k.title.toLowerCase()] = k.id;
    });

    for (const item of sourceItems) {
      if (item.url) {
        // ── Bookmark ────────────────────────────────────────────
        if (existingUrls.has(item.url)) {
          // Duplicate — delete from imported folder
          await new Promise(r => chrome.bookmarks.remove(item.id, r));
          duplicates++;
        } else {
          // New — move to target
          existingUrls.add(item.url);
          await new Promise(r => chrome.bookmarks.move(item.id, { parentId: targetParentId }, r));
          moved++;
        }
      } else {
        // ── Subfolder ───────────────────────────────────────────
        const key = item.title.toLowerCase();
        let targetSubId = subFolderMap[key];

        if (targetSubId) {
          // Merge into the existing same-named folder
          console.log(`  🔀 Merging into existing folder: "${item.title}"`);
        } else {
          // Create a new folder in target
          const newFolder = await new Promise(r =>
            chrome.bookmarks.create({ parentId: targetParentId, title: item.title }, r)
          );
          targetSubId = newFolder.id;
          subFolderMap[key] = targetSubId;
          console.log(`  📁 Created folder: "${item.title}"`);
        }

        // Recurse into the subfolder
        await processFolder(item.children || [], targetSubId);

        // Remove the now-empty source subfolder
        try {
          await new Promise(r => chrome.bookmarks.removeTree(item.id, r));
        } catch (e) {
          console.warn(`  ⚠️  Could not remove source folder "${item.title}": ${e.message}`);
        }
      }
    }
  }

  console.log('⏳ Merging bookmarks...\n');
  await processFolder(importedFolder.children || [], bookmarksBar.id);

  // ── 5. Remove the now-empty imported folder ──────────────────
  try {
    await new Promise(r => chrome.bookmarks.removeTree(importedFolder.id, r));
    console.log(`\n🗑️  Removed empty "${importedFolder.title}" folder`);
  } catch (e) {
    console.warn(`\n⚠️  Could not remove "${importedFolder.title}" folder: ${e.message}`);
  }

  // ── 6. Summary ───────────────────────────────────────────────
  console.log('\n✅ Done!');
  console.log(`   Moved to Bookmarks Bar : ${moved}`);
  console.log(`   Duplicates removed     : ${duplicates}`);
  console.log('\nRefresh the Bookmarks Manager (F5) to see your updated bookmarks.');
})();
