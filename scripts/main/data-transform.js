/*
  Data normalization + transform helpers for tree data.
  Extracted from main.js to reduce monolith size.
*/

(function () {
  const externalMainUtils =
    (typeof window !== 'undefined' && window.AncestrioMainUtils)
      ? window.AncestrioMainUtils
      : {};

  const safe = (typeof externalMainUtils.safe === 'function')
    ? externalMainUtils.safe
    : function safeFallback(v) {
      return v == null ? '' : String(v);
    };

  const readTags = (typeof externalMainUtils.readTags === 'function')
    ? externalMainUtils.readTags
    : function readTagsFallback(value) {
      if (!value) return [];
      if (typeof value === 'string') return [value.trim()].filter(Boolean);
      if (Array.isArray(value)) {
        return value
          .map((tag) => (tag == null ? '' : String(tag).trim()))
          .filter((tag) => tag.length > 0);
      }
      if (typeof value === 'object' && value.tag) {
        return readTagsFallback(value.tag);
      }
      return [];
    };

  function looksLikeRFamilySchema(obj) {
    return obj && (obj.Parent || obj.Grandparent);
  }

  function hasExplicitOriginInRFamilyNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.isOrigin) return true;

    const childCollections = [];
    if (Array.isArray(node.Parent)) childCollections.push(node.Parent);
    if (Array.isArray(node.children)) childCollections.push(node.children);
    if (Array.isArray(node.grandchildren)) childCollections.push(node.grandchildren);

    for (const collection of childCollections) {
      for (const child of collection) {
        if (hasExplicitOriginInRFamilyNode(child)) return true;
      }
    }

    return false;
  }

  function toSpouseEntries(rawSpouse) {
    if (!rawSpouse) return [];
    const rawList = Array.isArray(rawSpouse) ? rawSpouse : [rawSpouse];
    const entries = [];

    rawList.forEach((item) => {
      if (!item) return;

      if (typeof item === 'string') {
        const name = safe(item).trim();
        if (!name) return;
        entries.push({ name, image: '', birthday: '', tags: [], parents: null });
        return;
      }

      if (typeof item === 'object') {
        const name = safe(item.name).trim();
        const image = safe(item.image).trim();
        const birthday = safe(item.birthday || item.dob).trim();
        const tags = readTags(item.tags);
        const parents = item.parents && typeof item.parents === 'object' ? item.parents : null;
        const hasData = !!(name || image || birthday || tags.length || parents);
        if (!hasData) return;
        entries.push({ name, image, birthday, tags, parents });
      }
    });

    return entries;
  }

  function pickSpouseSides(rawSpouse, legacyPrevSpouse) {
    const entries = toSpouseEntries(rawSpouse);
    const right = entries[0] || null;
    let left = entries[1] || null;

    if (!left && legacyPrevSpouse) {
      const fallbackName = safe(legacyPrevSpouse.name).trim();
      const fallbackImage = safe(legacyPrevSpouse.image).trim();
      const fallbackBirthday = safe(legacyPrevSpouse.birthday || legacyPrevSpouse.dob).trim();
      const fallbackTags = readTags(legacyPrevSpouse.tags);
      if (fallbackName || fallbackImage || fallbackBirthday || fallbackTags.length) {
        left = {
          name: fallbackName,
          image: fallbackImage,
          birthday: fallbackBirthday,
          tags: fallbackTags,
          parents: legacyPrevSpouse.parents && typeof legacyPrevSpouse.parents === 'object'
            ? legacyPrevSpouse.parents
            : null
        };
      }
    }

    return { right, left, all: entries };
  }

  function toPrevSpouseField(entry) {
    if (!entry) return undefined;
    return {
      name: safe(entry.name),
      image: safe(entry.image),
      birthday: safe(entry.birthday),
      tags: readTags(entry.tags)
    };
  }

  // Transform rfamily.json into a uniform couple tree (preserving image + gender)
  function transformRFamily(src) {
    const centerName = safe(src && src.setupContext && src.setupContext.centerName).trim().toLowerCase();
    const shouldInferOrigin = !hasExplicitOriginInRFamilyNode(src) && !!centerName;
    let inferredOriginAssigned = false;
    const inferOriginByName = (candidateName) => {
      if (!shouldInferOrigin || inferredOriginAssigned) return false;
      const normalizedName = safe(candidateName).trim().toLowerCase();
      if (!normalizedName || normalizedName !== centerName) return false;
      inferredOriginAssigned = true;
      return true;
    };

    const rootSpouses = pickSpouseSides(src.spouse, src.prevSpouse);
    const rootPrimarySpouse = rootSpouses.right;
    const rootPrevSpouse = rootSpouses.left;
    const paternal = src.parents ? src.parents : null;
    const paternalSpouses = paternal ? pickSpouseSides(paternal.spouse, paternal.prevSpouse) : null;
    const maternal = rootSpouses.all.find((spouse) => spouse && spouse.parents)?.parents || null;
    const maternalSpouses = maternal ? pickSpouseSides(maternal.spouse, maternal.prevSpouse) : null;
    const grandparentName = safe(src.Grandparent);
    const grandparentSpouse = safe(rootPrimarySpouse && rootPrimarySpouse.name);
    const gpCouple = {
      name: grandparentName,
      image: safe(src.image),
      birthday: safe(src.birthday || src.dob),
      isOrigin: !!src.isOrigin || inferOriginByName(src.Grandparent),
      spouse: grandparentSpouse,
      spouseImage: safe(rootPrimarySpouse && rootPrimarySpouse.image),
      spouseBirthday: safe(rootPrimarySpouse && rootPrimarySpouse.birthday),
      tags: readTags(src.tags),
      spouseTags: readTags(rootPrimarySpouse && rootPrimarySpouse.tags),
      children: []
    };
    const normalizedRootPrev = toPrevSpouseField(rootPrevSpouse);
    if (normalizedRootPrev) {
      gpCouple.prevSpouse = normalizedRootPrev;
    }
    if (paternal && (safe(paternal.name) || (paternalSpouses && (paternalSpouses.right || paternalSpouses.left)))) {
      gpCouple.parents = {
        name: safe(paternal.name),
        image: safe(paternal.image),
        birthday: safe(paternal.birthday || paternal.dob),
        spouse: paternalSpouses.right ? safe(paternalSpouses.right.name) : '',
        spouseImage: paternalSpouses.right ? safe(paternalSpouses.right.image) : '',
        spouseBirthday: paternalSpouses.right ? safe(paternalSpouses.right.birthday) : '',
        tags: readTags(paternal.tags),
        spouseTags: paternalSpouses.right ? readTags(paternalSpouses.right.tags) : []
      };
      const paternalPrev = toPrevSpouseField(paternalSpouses.left);
      if (paternalPrev) gpCouple.parents.prevSpouse = paternalPrev;
    }
    if (maternal && (safe(maternal.name) || (maternalSpouses && (maternalSpouses.right || maternalSpouses.left)))) {
      gpCouple.spouseParents = {
        name: safe(maternal.name),
        image: safe(maternal.image),
        birthday: safe(maternal.birthday || maternal.dob),
        spouse: maternalSpouses.right ? safe(maternalSpouses.right.name) : '',
        spouseImage: maternalSpouses.right ? safe(maternalSpouses.right.image) : '',
        spouseBirthday: maternalSpouses.right ? safe(maternalSpouses.right.birthday) : '',
        tags: readTags(maternal.tags),
        spouseTags: maternalSpouses.right ? readTags(maternalSpouses.right.tags) : []
      };
      const maternalPrev = toPrevSpouseField(maternalSpouses.left);
      if (maternalPrev) gpCouple.spouseParents.prevSpouse = maternalPrev;
    }

    // Parents generation (children of Grandparents)
    const parents = Array.isArray(src.Parent) ? src.Parent : [];
    parents.forEach((p) => {
      const parentSpouses = pickSpouseSides(p.spouse, p.prevSpouse);
      const rawParentSpouseIndex = Number(p.fromSpouseIndex);
      const parentFromSpouseIndex = Number.isFinite(rawParentSpouseIndex)
        ? Math.max(0, Math.trunc(rawParentSpouseIndex))
        : (p.fromPrevSpouse ? 1 : 0);
      const pc = {
        name: safe(p.name),
        image: safe(p.image),
        birthday: safe(p.birthday || p.dob),
        isOrigin: !!p.isOrigin || inferOriginByName(p.name),
        prevSpouse: toPrevSpouseField(parentSpouses.left),
        spouse: parentSpouses.right ? safe(parentSpouses.right.name) : '',
        spouseImage: parentSpouses.right ? safe(parentSpouses.right.image) : '',
        spouseBirthday: parentSpouses.right ? safe(parentSpouses.right.birthday) : '',
        tags: readTags(p.tags),
        spouseTags: parentSpouses.right ? readTags(parentSpouses.right.tags) : [],
        children: [],
        fromSpouseIndex: parentFromSpouseIndex,
        fromPrevSpouse: !!p.fromPrevSpouse || parentFromSpouseIndex > 0
      };
      gpCouple.children.push(pc);

      // Children generation (children of each Parent)
      const kids = Array.isArray(p.children)
        ? p.children
        : (Array.isArray(p.grandchildren) ? p.grandchildren : []);
      kids.forEach((k) => {
        const rawFromSpouseIndex = Number(k.fromSpouseIndex);
        const fromSpouseIndex = Number.isFinite(rawFromSpouseIndex)
          ? Math.max(0, Math.trunc(rawFromSpouseIndex))
          : (k.fromPrevSpouse ? 1 : 0);
        const childSpouses = pickSpouseSides(k.spouse, k.prevSpouse);
        const kc = {
          name: safe(k.name),
          image: safe(k.image),
          birthday: safe(k.birthday || k.dob),
          isOrigin: !!k.isOrigin || inferOriginByName(k.name),
          prevSpouse: toPrevSpouseField(childSpouses.left),
          spouse: childSpouses.right ? safe(childSpouses.right.name) : '',
          spouseImage: childSpouses.right ? safe(childSpouses.right.image) : '',
          spouseBirthday: childSpouses.right ? safe(childSpouses.right.birthday) : '',
          tags: readTags(k.tags),
          spouseTags: childSpouses.right ? readTags(childSpouses.right.tags) : [],
          children: [],
          fromSpouseIndex,
          fromPrevSpouse: !!k.fromPrevSpouse || fromSpouseIndex > 0
        };
        pc.children.push(kc);

        // Grandchildren (great-grandkids relative to the root)
        const gk = Array.isArray(k.grandchildren) ? k.grandchildren : [];
        gk.forEach((gchild) => {
          kc.children.push({
            name: safe(gchild.name),
            image: safe(gchild.image),
            birthday: safe(gchild.birthday || gchild.dob),
            isOrigin: !!gchild.isOrigin || inferOriginByName(gchild.name),
            tags: readTags(gchild.tags)
          });
        });
      });

      // Support simpler case where Parent lists immediate children as strings.
      if (Array.isArray(p.childrenStrings)) {
        p.childrenStrings.forEach((nm) => pc.children.push({ name: safe(nm) }));
      }
    });

    return gpCouple;
  }

  function thumbPath(image) {
    const s = safe(image).trim();
    if (!s || s.startsWith('data:')) return '';
    if (s.startsWith('images/thumbs/')) return s;
    if (s.startsWith('images/')) return `images/thumbs/${s.slice('images/'.length)}`;
    return s;
  }

  function attachThumbsToEntity(entity) {
    if (!entity) return;
    entity.thumb = entity.thumb || thumbPath(entity.image);
    if (entity.spouse || entity.spouseImage) {
      entity.spouseThumb = entity.spouseThumb || thumbPath(entity.spouseImage);
    }
  }

  function attachThumbs(node) {
    if (!node || typeof node !== 'object') return node;
    attachThumbsToEntity(node);
    if (node.prevSpouse) attachThumbsToEntity(node.prevSpouse);
    if (node.parents) attachThumbsToEntity(node.parents);
    if (node.spouseParents) attachThumbsToEntity(node.spouseParents);
    (node.children || []).forEach((child) => attachThumbs(child));
    return node;
  }

  function normalizeData(input) {
    console.log('normalizeData called with:', input);
    if (looksLikeRFamilySchema(input)) {
      console.log('Detected rfamily schema');
      const transformed = transformRFamily(input);
      console.log('Transformed data:', transformed);
      const result = attachThumbs(transformed);
      console.log('After attachThumbs:', result);
      return result;
    }
    console.log('Using data as-is (couple schema)');
    const result = attachThumbs(input);
    console.log('After attachThumbs:', result);
    return result;
  }

  window.AncestrioDataTransform = window.AncestrioDataTransform || {};
  window.AncestrioDataTransform.looksLikeRFamilySchema = looksLikeRFamilySchema;
  window.AncestrioDataTransform.toSpouseEntries = toSpouseEntries;
  window.AncestrioDataTransform.pickSpouseSides = pickSpouseSides;
  window.AncestrioDataTransform.toPrevSpouseField = toPrevSpouseField;
  window.AncestrioDataTransform.transformRFamily = transformRFamily;
  window.AncestrioDataTransform.thumbPath = thumbPath;
  window.AncestrioDataTransform.attachThumbsToEntity = attachThumbsToEntity;
  window.AncestrioDataTransform.attachThumbs = attachThumbs;
  window.AncestrioDataTransform.normalizeData = normalizeData;
})();
