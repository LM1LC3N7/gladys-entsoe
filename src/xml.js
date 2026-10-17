// -----------------------------------------------------------------------------
// A minimal, linear XML scanner for the ENTSO-E documents: no dependency, no
// regular expression over the document, every `indexOf` starts after the
// previous match, so the work is proportional to the size of the input (which
// http.js caps). It reports the elements (namespace prefixes dropped) and the
// text of the leaf elements; it ignores attributes, comments and processing
// instructions, and refuses a DOCTYPE (no entity is ever expanded) or a
// document deeper than `maxDepth`.
// -----------------------------------------------------------------------------

export class XmlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XmlError';
  }
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The five predefined entities and the numeric references, nothing else. */
export function decodeText(text) {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}

const localName = (qname) => {
  const colon = qname.indexOf(':');
  return colon === -1 ? qname : qname.slice(colon + 1);
};

/** The index of the `>` closing a tag opened at `from`, quotes respected. */
function tagEnd(text, from) {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        quote = '';
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

function nameOf(inner) {
  let end = 0;
  while (end < inner.length && !' \t\r\n/'.includes(inner[end])) {
    end += 1;
  }
  return localName(inner.slice(0, end));
}

/**
 * Scan `text`, calling `onOpen(name, parent)` and `onClose(name, text, parent)`
 * (`text` is the decoded content of a leaf, '' for an element with children).
 */
export function scanXml(text, { onOpen = () => {}, onClose = () => {}, maxDepth = 16 } = {}) {
  const stack = [];
  // Per open element: did it get a child, and its text chunks so far.
  const frames = [];
  let i = 0;
  let sawRoot = false;
  const fail = (what) => {
    throw new XmlError(`Malformed XML: ${what}`);
  };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const chunkEnd = lt === -1 ? text.length : lt;
    if (chunkEnd > i && frames.length > 0) {
      frames[frames.length - 1].text.push(text.slice(i, chunkEnd));
    }
    if (lt === -1) {
      break;
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) fail('unclosed comment');
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) fail('unclosed CDATA');
      if (frames.length > 0) {
        // Raw text: protect it from the entity decoding of the leaf.
        frames[frames.length - 1].text.push(text.slice(lt + 9, end).replaceAll('&', '&amp;'));
      }
      i = end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) fail('unclosed processing instruction');
      i = end + 2;
    } else if (text.startsWith('<!', lt)) {
      fail('DOCTYPE and declarations are not accepted');
    } else if (text.startsWith('</', lt)) {
      const gt = text.indexOf('>', lt + 2);
      if (gt === -1) fail('unclosed end tag');
      const name = localName(text.slice(lt + 2, gt).trim());
      if (stack.length === 0 || stack[stack.length - 1] !== name) {
        fail(`unexpected </${name}>`);
      }
      stack.pop();
      const frame = frames.pop();
      onClose(name, frame.child ? '' : decodeText(frame.text.join('').trim()), stack.at(-1));
      i = gt + 1;
    } else {
      const gt = tagEnd(text, lt + 1);
      if (gt === -1) fail('unclosed tag');
      const inner = text.slice(lt + 1, gt);
      const name = nameOf(inner);
      if (!name) fail('empty tag name');
      if (stack.length === 0) {
        if (sawRoot) fail('more than one root element');
        sawRoot = true;
      } else {
        frames[frames.length - 1].child = true;
      }
      const parent = stack.at(-1);
      onOpen(name, parent);
      if (inner.endsWith('/')) {
        onClose(name, '', parent);
      } else {
        if (stack.length >= maxDepth) fail('too deep');
        stack.push(name);
        frames.push({ child: false, text: [] });
      }
      i = gt + 1;
    }
  }
  if (stack.length > 0) fail(`unclosed <${stack.at(-1)}>`);
  if (!sawRoot) fail('no root element');
}
