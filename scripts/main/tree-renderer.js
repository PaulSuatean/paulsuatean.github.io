/*
  Tree rendering controller for tree viewer pages.
  Keeps heavy D3 layout/render logic out of main.js.
*/

(function () {
  function createTreeRenderer(options) {
    const opts = options || {};
    const g = opts.g;
    const defs = opts.defs;
    const person = opts.person || { width: 170, height: 120, hGap: 48 };
    const level = opts.level || { vGap: 180 };
    const avatar = opts.avatar || { r: 36, top: 10 };
    const baseCoupleWidth = Number.isFinite(opts.baseCoupleWidth)
      ? opts.baseCoupleWidth
      : (person.width * 2 + person.hGap);
    const safe =
      typeof opts.safe === 'function'
        ? opts.safe
        : function safeFallback(v) { return v == null ? '' : String(v); };
    const readTags =
      typeof opts.readTags === 'function'
        ? opts.readTags
        : function readTagsFallback(v) {
          if (!v) return [];
          if (Array.isArray(v)) return v;
          return [String(v)];
        };
    const normalizeName =
      typeof opts.normalizeName === 'function'
        ? opts.normalizeName
        : function normalizeNameFallback(v) { return String(v || '').toLowerCase(); };
    const dnaHighlightNames = opts.dnaHighlightNames || new Set();
    const dnaSuppressNames = opts.dnaSuppressNames || new Set();
    const thumbPath =
      typeof opts.thumbPath === 'function'
        ? opts.thumbPath
        : function thumbPathFallback(image) { return image || ''; };
    const placeholderDataUrl = opts.placeholderDataUrl || '';
    const openModal =
      typeof opts.openModal === 'function'
        ? opts.openModal
        : function openModalFallback() {};
    const setDnaGroup =
      typeof opts.setDnaGroup === 'function'
        ? opts.setDnaGroup
        : function setDnaGroupFallback() {};
    const updateDNAVisibility =
      typeof opts.updateDNAVisibility === 'function'
        ? opts.updateDNAVisibility
        : function updateDNAVisibilityFallback() {};
    const fitTreeWhenVisible =
      typeof opts.fitTreeWhenVisible === 'function'
        ? opts.fitTreeWhenVisible
        : function fitTreeWhenVisibleFallback() {};
    const getTreeDefaultPadding =
      typeof opts.getTreeDefaultPadding === 'function'
        ? opts.getTreeDefaultPadding
        : function getTreeDefaultPaddingFallback() { return 36; };

    function asHierarchy(data) {
      return d3.hierarchy(data, (d) => d.children || []);
    }

    function restructureForOrigin(data) {
      function findOrigin(node) {
        if (node && node.isOrigin) return node;
        if (node && Array.isArray(node.children)) {
          for (const child of node.children) {
            const found = findOrigin(child);
            if (found) return found;
          }
        }
        return null;
      }

      const originNode = findOrigin(data);
      if (!originNode) return data;

      function findNodeAndParent(current, target, parent = null) {
        if (current === target) return { node: current, parent };
        if (current && Array.isArray(current.children)) {
          for (const child of current.children) {
            const result = findNodeAndParent(child, target, current);
            if (result) return result;
          }
        }
        return null;
      }

      const result = findNodeAndParent(data, originNode);
      if (!result || !result.parent) return data;

      const newRoot = JSON.parse(JSON.stringify(originNode));
      if (!Array.isArray(newRoot.children)) {
        newRoot.children = [];
      }

      const parentCopy = JSON.parse(JSON.stringify(result.parent));
      const originIndex = Array.isArray(result.parent.children)
        ? result.parent.children.indexOf(originNode)
        : -1;
      if (Array.isArray(parentCopy.children) && originIndex >= 0) {
        parentCopy.children.splice(originIndex, 1);
      }
      newRoot.parents = parentCopy;
      return newRoot;
    }

    function hasSpouseData(d) {
      const data = d && d.data ? d.data : {};
      const right = typeof data.spouse === 'string' && data.spouse.trim() !== '';
      const left = !!(data.prevSpouse && ((data.prevSpouse.name && String(data.prevSpouse.name).trim() !== '') || data.prevSpouse.image));
      return right || left;
    }

    function nodeWidth(d) {
      const data = d && d.data ? d.data : {};
      const right = typeof data.spouse === 'string' && data.spouse.trim() !== '';
      const left = !!(data.prevSpouse && ((data.prevSpouse.name && String(data.prevSpouse.name).trim() !== '') || data.prevSpouse.image));
      const count = 1 + (right ? 1 : 0) + (left ? 1 : 0);
      return person.width * count + person.hGap * (count - 1);
    }

    function drawPerson(sel, personOpts) {
      const tagList = Array.isArray(personOpts.tags) ? personOpts.tags : [];
      const normalizedTags = tagList
        .map((tag) => (tag == null ? '' : String(tag).trim().toLowerCase()))
        .filter((tag) => tag.length > 0);
      const hasVeteranTag = normalizedTags.includes('veteran');
      const classes = ['person'];
      if (personOpts.role) classes.push(personOpts.role);
      if (hasVeteranTag) classes.push('tag-veteran');
      const nameKey = normalizeName(personOpts.name);
      if (nameKey && dnaHighlightNames.has(nameKey)) classes.push('dna-highlight');
      if (nameKey && dnaSuppressNames.has(nameKey)) classes.push('dna-suppress');

      const gPerson = sel.append('g').attr('class', classes.join(' ')).attr('transform', `translate(${personOpts.x},${personOpts.y})`);

      gPerson.append('rect')
        .attr('width', person.width)
        .attr('height', person.height)
        .attr('rx', 12).attr('ry', 12);

      if (hasVeteranTag) {
        const badge = gPerson.append('g')
          .attr('class', 'badge-veteran')
          .attr('transform', 'translate(22, 20)')
          .attr('pointer-events', 'none');

        badge.append('path')
          .attr('class', 'medal-ribbon')
          .attr('d', 'M -6 10 L -2 4 L 0 10 L 2 4 L 6 10 L 6 18 L 2 14 L 0 18 L -2 14 L -6 18 Z');

        badge.append('circle')
          .attr('cx', 0)
          .attr('cy', 0)
          .attr('r', 11);

        badge.append('path')
          .attr('class', 'medal-star')
          .attr('d', 'M 0,-7 L 2.2,-2.2 L 7,-2.2 L 3.2,0.8 L 4.6,6 L 0,3.2 L -4.6,6 L -3.2,0.8 L -7,-2.2 L -2.2,-2.2 Z');
      }

      const clipId = `clip-${Math.random().toString(36).slice(2, 9)}`;
      const cp = defs.append('clipPath').attr('id', clipId);
      cp.append('circle').attr('cx', 0).attr('cy', 0).attr('r', avatar.r);

      const cx = person.width / 2;
      const cy = avatar.top + avatar.r;
      const gAvatar = gPerson.append('g').attr('transform', `translate(${cx},${cy})`);
      const thumbSrc = personOpts.thumb || thumbPath(personOpts.image);
      const fullSrc = personOpts.image || '';
      const preferred = thumbSrc || fullSrc || placeholderDataUrl;
      const imgEl = gAvatar.append('image')
        .attr('href', preferred)
        .attr('xlink:href', preferred)
        .attr('x', -avatar.r)
        .attr('y', -avatar.r)
        .attr('width', avatar.r * 2)
        .attr('height', avatar.r * 2)
        .attr('clip-path', `url(#${clipId})`)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('loading', 'lazy')
        .attr('decoding', 'async');

      imgEl.on('error', function () {
        const fallback = fullSrc || placeholderDataUrl;
        if (!fallback || this.getAttribute('href') === fallback) return;
        this.setAttribute('href', fallback);
        this.setAttributeNS('http://www.w3.org/1999/xlink', 'href', fallback);
      });

      gPerson.append('text')
        .attr('class', 'name')
        .attr('x', person.width / 2)
        .attr('y', avatar.top + avatar.r * 2 + 22)
        .attr('text-anchor', 'middle')
        .text(personOpts.name || '');

      gPerson.on('click', () => {
        openModal({ name: personOpts.name, image: personOpts.image || placeholderDataUrl, birthday: personOpts.birthday });
      });
    }

    function render(data) {
      if (!g) return;
      g.selectAll('*').remove();

      const getSpouseSortIndex = (nodeData) => {
        if (!nodeData || typeof nodeData !== 'object') return 0;
        const rawSpouseIndex = Number(nodeData.fromSpouseIndex);
        if (Number.isFinite(rawSpouseIndex)) {
          return Math.max(0, Math.trunc(rawSpouseIndex));
        }
        return nodeData.fromPrevSpouse ? 1 : 0;
      };

      const sortBySpouseGroup = (nodeData) => {
        if (!nodeData || typeof nodeData !== 'object' || !Array.isArray(nodeData.children)) return nodeData;
        nodeData.children = nodeData.children
          .map((child, index) => ({ child, index }))
          .sort((a, b) => {
            const spouseDiff = getSpouseSortIndex(b.child) - getSpouseSortIndex(a.child);
            if (spouseDiff !== 0) return spouseDiff;
            return a.index - b.index;
          })
          .map((entry) => sortBySpouseGroup(entry.child));
        return nodeData;
      };

      const restructuredData = sortBySpouseGroup(JSON.parse(JSON.stringify(restructureForOrigin(data))));
      const root = asHierarchy(restructuredData);

      const tree = d3.tree()
        .nodeSize([baseCoupleWidth, person.height + level.vGap])
        .separation((a, b) => {
          const gap = Math.max(16, person.width * 0.35);
          const needed = (nodeWidth(a) / 2) + gap + (nodeWidth(b) / 2);
          const base = needed / baseCoupleWidth;
          return a.parent === b.parent ? base : base * 1.4;
        });

      tree(root);

      const splitPad = 18;
      function layoutFor(nodeData) {
        const hasLeft = !!(nodeData.prevSpouse && ((nodeData.prevSpouse.name && String(nodeData.prevSpouse.name).trim() !== '') || nodeData.prevSpouse.image));
        const hasRight = typeof nodeData.spouse === 'string' && nodeData.spouse.trim() !== '';
        const count = 1 + (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);
        const totalWidth = person.width * count + person.hGap * (count - 1);
        const leftStart = -totalWidth / 2;
        const xPrimary = leftStart + (hasLeft ? (person.width + person.hGap) : 0);
        const xLeftSpouse = hasLeft ? leftStart : null;
        const xRightSpouse = hasRight ? (xPrimary + person.width + person.hGap) : null;
        return { hasLeft, hasRight, count, totalWidth, leftStart, xPrimary, xLeftSpouse, xRightSpouse, left: hasLeft, right: hasRight };
      }
      function topOfPrimary(node) {
        const L = layoutFor(node.data);
        return { x: node.x + L.xPrimary + person.width / 2, y: node.y - person.height / 2 };
      }
      function bottomOfRightSpouse(node) {
        const L = layoutFor(node.data);
        if (!L.hasRight) return null;
        return { x: node.x + L.xRightSpouse + person.width / 2, y: node.y + person.height / 2 };
      }
      function topOfRightSpouse(node) {
        const L = layoutFor(node.data);
        if (!L.hasRight) return null;
        return { x: node.x + L.xRightSpouse + person.width / 2, y: node.y - person.height / 2 };
      }
      function junctionBelow(node) { return { x: node.x, y: node.y + (person.height / 2) + splitPad }; }

      const mergePad = Math.max(24, person.height * 0.35);
      const mergeCurves = [];
      const trunkCommon = [];
      const marriageNoKids = [];
      const branches = [];
      const overlayCouples = [];

      function addOverlayCouple(info, placementAnchor, childAnchor, alignCenter, swapPrimarySpouse, isDNA) {
        if (!info || !placementAnchor || !childAnchor) return;
        const payload = {
          name: safe(info.name),
          image: safe(info.image),
          birthday: safe(info.birthday),
          spouse: safe(info.spouse),
          spouseImage: safe(info.spouseImage),
          spouseBirthday: safe(info.spouseBirthday),
          tags: readTags(info.tags),
          spouseTags: readTags(info.spouseTags || (info.spouse && info.spouse.tags))
        };
        if (swapPrimarySpouse) {
          const tmp = {
            name: payload.name,
            image: payload.image,
            birthday: payload.birthday,
            tags: payload.tags
          };
          payload.name = payload.spouse;
          payload.image = payload.spouseImage;
          payload.birthday = payload.spouseBirthday;
          payload.tags = payload.spouseTags;
          payload.spouse = tmp.name;
          payload.spouseImage = tmp.image;
          payload.spouseBirthday = tmp.birthday;
          payload.spouseTags = tmp.tags;
        }
        if (!payload.name && !payload.spouse) return;

        const layout = layoutFor(payload);
        let centerX = placementAnchor.x + (person.width / 2);
        if (alignCenter === 'primary') {
          const primaryCenter = layout.xPrimary + (person.width / 2);
          centerX = childAnchor.x - primaryCenter;
        } else if (alignCenter === 'spouse' && layout.hasRight) {
          const spouseCenter = layout.xRightSpouse + (person.width / 2);
          centerX = childAnchor.x - spouseCenter;
        }

        const unionX = centerX;
        const center = { x: centerX, y: placementAnchor.y + (person.height / 2) };
        const primaryInterior = { x: centerX + layout.xPrimary + person.width, y: center.y };
        const spouseInterior = layout.hasRight ? { x: centerX + layout.xRightSpouse, y: center.y } : null;
        const mergeTarget = { x: unionX, y: center.y + mergePad };
        mergeCurves.push({ source: primaryInterior, target: mergeTarget, isDNA: !!isDNA });
        if (spouseInterior) mergeCurves.push({ source: spouseInterior, target: mergeTarget, isDNA: !!isDNA });
        const childPoint = { x: childAnchor.x, y: childAnchor.y };
        branches.push({ source: mergeTarget, target: childPoint, isDNA: !!isDNA });
        overlayCouples.push({ center, layout, data: payload });
      }

      root.descendants().forEach((parentNode) => {
        const isRoot = parentNode.depth === 0;

        if (parentNode.data && parentNode.data.spouseParents) {
          const childAnchor = topOfRightSpouse(parentNode);
          const placementAnchor = childAnchor ? {
            x: childAnchor.x - (person.width / 2),
            y: childAnchor.y - person.height - mergePad
          } : childAnchor;
          addOverlayCouple(parentNode.data.spouseParents, placementAnchor, childAnchor, 'primary', true, false);
        }
        if (parentNode.data && parentNode.data.parents) {
          const childAnchor = topOfPrimary(parentNode);
          const placementAnchor = {
            x: childAnchor.x - (person.width / 2),
            y: childAnchor.y - person.height - mergePad
          };
          addOverlayCouple(parentNode.data.parents, placementAnchor, childAnchor, 'spouse', false, false);
        }

        const layout = layoutFor(parentNode.data || {});
        const hasChildren = Array.isArray(parentNode.children) && parentNode.children.length > 0;
        const yCenter = parentNode.y;
        const yMerge = yCenter + mergePad;
        const yJ = junctionBelow(parentNode).y;
        const anchorPrimaryLeft = { x: parentNode.x + layout.xPrimary, y: yCenter };
        const anchorPrimaryRight = { x: parentNode.x + layout.xPrimary + person.width, y: yCenter };
        const anchorLeftSpouseRight = layout.hasLeft ? { x: parentNode.x + layout.xLeftSpouse + person.width, y: yCenter } : null;
        const anchorRightSpouseLeft = layout.hasRight ? { x: parentNode.x + layout.xRightSpouse, y: yCenter } : null;

        if (!hasChildren) {
          if (layout.hasRight && anchorRightSpouseLeft) {
            marriageNoKids.push({
              x0: Math.min(anchorPrimaryRight.x, anchorRightSpouseLeft.x),
              x1: Math.max(anchorPrimaryRight.x, anchorRightSpouseLeft.x),
              y: yCenter,
              isDNA: true
            });
          }
          if (layout.hasLeft && anchorLeftSpouseRight) {
            marriageNoKids.push({
              x0: Math.min(anchorLeftSpouseRight.x, anchorPrimaryLeft.x),
              x1: Math.max(anchorLeftSpouseRight.x, anchorPrimaryLeft.x),
              y: yCenter,
              isDNA: true
            });
          }
          return;
        }

        let hasLeftChild = false;
        let hasRightChild = false;
        parentNode.children.forEach((childNode) => {
          if (childNode.data && childNode.data.fromPrevSpouse) hasLeftChild = true;
          else hasRightChild = true;
        });

        if (layout.hasLeft && !hasLeftChild && anchorLeftSpouseRight) {
          marriageNoKids.push({
            x0: Math.min(anchorLeftSpouseRight.x, anchorPrimaryLeft.x),
            x1: Math.max(anchorLeftSpouseRight.x, anchorPrimaryLeft.x),
            y: yCenter,
            isDNA: true
          });
        }
        if (layout.hasRight && !hasRightChild && anchorRightSpouseLeft) {
          marriageNoKids.push({
            x0: Math.min(anchorPrimaryRight.x, anchorRightSpouseLeft.x),
            x1: Math.max(anchorPrimaryRight.x, anchorRightSpouseLeft.x),
            y: yCenter,
            isDNA: true
          });
        }

        if (layout.hasLeft && hasLeftChild && anchorLeftSpouseRight) {
          const xMergeLeft = (anchorLeftSpouseRight.x + anchorPrimaryLeft.x) / 2;
          const tLeft = { x: xMergeLeft, y: yMerge };
          mergeCurves.push({ source: anchorLeftSpouseRight, target: tLeft, isDNA: false });
          mergeCurves.push({ source: anchorPrimaryLeft, target: tLeft, isDNA: true });
          trunkCommon.push({ x: xMergeLeft, y0: yMerge, y1: yJ, isDNA: true });
          const jLeft = { x: xMergeLeft, y: yJ };
          parentNode.children.forEach((childNode) => {
            if (childNode.data && childNode.data.fromPrevSpouse) {
              branches.push({ source: jLeft, target: topOfPrimary(childNode), parent: parentNode, child: childNode, isDNA: true });
            }
          });
        }

        if (layout.hasRight && hasRightChild && anchorRightSpouseLeft) {
          const xMergeRight = (anchorPrimaryRight.x + anchorRightSpouseLeft.x) / 2;
          const tRight = { x: xMergeRight, y: yMerge };
          mergeCurves.push({ source: anchorPrimaryRight, target: tRight, isDNA: true });
          mergeCurves.push({ source: anchorRightSpouseLeft, target: tRight, isDNA: isRoot });
          trunkCommon.push({ x: xMergeRight, y0: yMerge, y1: yJ, isDNA: true });
          const jRight = { x: xMergeRight, y: yJ };
          parentNode.children.forEach((childNode) => {
            if (!(childNode.data && childNode.data.fromPrevSpouse)) {
              branches.push({ source: jRight, target: topOfPrimary(childNode), parent: parentNode, child: childNode, isDNA: true });
            }
          });
        }
      });

      const linkGen = d3.linkVertical().x((d) => d.x).y((d) => d.y);
      function unionCurvePath(d) {
        const x0 = d.source.x;
        const y0 = d.source.y;
        const x1 = d.target.x;
        const y1 = d.target.y;
        const dx = x1 - x0;
        const dir = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
        const lead = Math.max(12, Math.min(30, Math.abs(dx) * 0.33));
        const dy = Math.max(30, y1 - y0);
        const c1x = x0 + dir * lead;
        const c1y = y0;
        const c2x = x1;
        const c2y = y1 - dy * 0.6;
        return `M ${x0},${y0} C ${c1x},${c1y} ${c2x},${c2y} ${x1},${y1}`;
      }

      g.append('g')
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .selectAll('path.curve')
        .data(mergeCurves)
        .join('path')
        .attr('class', 'link')
        .attr('d', (d) => unionCurvePath(d));

      g.append('g')
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .selectAll('path.trunk')
        .data(trunkCommon)
        .join('path')
        .attr('class', 'link trunk')
        .attr('d', (t) => `M ${t.x},${t.y0} V ${t.y1}`);

      g.append('g')
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .selectAll('path.marriage-no-kids')
        .data(marriageNoKids)
        .join('path')
        .attr('class', 'link marriage-no-kids')
        .attr('d', (t) => `M ${t.x0},${t.y} H ${t.x1}`);

      g.append('g')
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .selectAll('path.branch')
        .data(branches)
        .join('path')
        .attr('class', 'link branch')
        .attr('d', (d) => linkGen(d));

      g.append('g')
        .attr('display', 'none')
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .selectAll('path.blood-link')
        .data(branches)
        .join('path')
        .attr('class', 'blood-link')
        .attr('d', (d) => linkGen(d));

      const couples = g.append('g')
        .selectAll('g.couple')
        .data(root.descendants())
        .join('g')
        .attr('class', 'couple')
        .attr('transform', (d) => `translate(${d.x},${d.y})`);

      couples.each(function (d) {
        const L = layoutFor(d.data);
        const group = d3.select(this);

        drawPerson(group, {
          x: L.xPrimary,
          y: -person.height / 2,
          name: d.data.name,
          meta: '',
          image: d.data.image,
          thumb: d.data.thumb,
          birthday: d.data.birthday,
          role: 'primary',
          tags: d.data.tags
        });

        if (L.hasLeft) {
          const ps = d.data.prevSpouse || {};
          drawPerson(group, {
            x: L.xLeftSpouse,
            y: -person.height / 2,
            name: ps.name,
            meta: '',
            image: ps.image,
            thumb: ps.thumb,
            birthday: ps.birthday,
            role: 'spouse',
            tags: ps.tags
          });
        }

        if (L.hasRight) {
          drawPerson(group, {
            x: L.xRightSpouse,
            y: -person.height / 2,
            name: d.data.spouse,
            meta: '',
            image: d.data.spouseImage,
            thumb: d.data.spouseThumb,
            birthday: d.data.spouseBirthday,
            role: 'spouse',
            tags: d.data.spouseTags
          });
        }
      });

      if (overlayCouples.length) {
        const overlayLayer = g.append('g').attr('class', 'overlay-layer').lower();
        const overlayGroup = overlayLayer
          .selectAll('g.couple.overlay')
          .data(overlayCouples)
          .join('g')
          .attr('class', 'couple overlay')
          .attr('transform', (d) => `translate(${d.center.x},${d.center.y})`);

        overlayGroup.each(function (d) {
          const group = d3.select(this);
          const L = d.layout;

          drawPerson(group, {
            x: L.xPrimary,
            y: -person.height / 2,
            name: d.data.name,
            image: d.data.image,
            thumb: d.data.thumb,
            birthday: d.data.birthday,
            role: 'primary',
            tags: d.data.tags
          });

          if (L.hasRight) {
            drawPerson(group, {
              x: L.xRightSpouse,
              y: -person.height / 2,
              name: d.data.spouse,
              image: d.data.spouseImage,
              thumb: d.data.spouseThumb,
              birthday: d.data.spouseBirthday,
              role: 'spouse',
              tags: d.data.spouseTags
            });
          }
        });
      }

      const dnaGroup = g.append('g');
      setDnaGroup(dnaGroup);

      dnaGroup.selectAll('path.blood-curve')
        .data(mergeCurves.filter((d) => d.isDNA))
        .join('path')
        .attr('class', 'blood-link')
        .attr('d', (d) => unionCurvePath(d));

      dnaGroup.selectAll('path.blood-trunk')
        .data(trunkCommon.filter((t) => t.isDNA))
        .join('path')
        .attr('class', 'blood-link')
        .attr('d', (t) => `M ${t.x},${t.y0} V ${t.y1}`);

      dnaGroup.selectAll('path.blood-marriage-no-kids')
        .data(marriageNoKids.filter((t) => t.isDNA))
        .join('path')
        .attr('class', 'blood-link')
        .attr('d', (t) => `M ${t.x0},${t.y} H ${t.x1}`);

      dnaGroup.selectAll('path.blood-branch')
        .data(branches.filter((b) => b.isDNA))
        .join('path')
        .attr('class', 'blood-link')
        .attr('d', (d) => linkGen(d));

      updateDNAVisibility();
      fitTreeWhenVisible(getTreeDefaultPadding(), 60);
      requestAnimationFrame(() => fitTreeWhenVisible(getTreeDefaultPadding(), 30));
    }

    return {
      render,
      asHierarchy,
      restructureForOrigin,
      drawPerson,
      nodeWidth,
      hasSpouseData
    };
  }

  window.AncestrioTreeRenderer = window.AncestrioTreeRenderer || {};
  window.AncestrioTreeRenderer.createTreeRenderer = createTreeRenderer;
})();
