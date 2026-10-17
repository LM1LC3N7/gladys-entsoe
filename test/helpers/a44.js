// -----------------------------------------------------------------------------
// Builds ENTSO-E answers for the tests, shaped after the real documents
// (Publication_MarketDocument 7:3, Acknowledgement_MarketDocument 7:0).
// -----------------------------------------------------------------------------

const iso = (t) => new Date(t).toISOString().replace(/:00\.000Z$/, 'Z');

/**
 * A Period of `minutes`-long slots from `start` (ms) with `count` positions;
 * `price(i)` gives the price of position i + 1 (EUR/MWh), `skip` lists the
 * positions left out (the "repeat the previous price" rule).
 */
export function period({ start, minutes = 15, count = 96, price = (i) => 50 + i, skip = [] }) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    if (!skip.includes(i + 1)) {
      points.push(
        `<Point>\n<position>${i + 1}</position>\n<price.amount>${price(i)}</price.amount>\n</Point>`,
      );
    }
  }
  return `<Period>
<timeInterval>
<start>${iso(start)}</start>
<end>${iso(start + count * minutes * 60_000)}</end>
</timeInterval>
<resolution>PT${minutes}M</resolution>
${points.join('\n')}
</Period>`;
}

export function series(
  periods,
  { sequence, contract = 'A01', currency = 'EUR', unit = 'MWH', eic = '10YFR-RTE------C' } = {},
) {
  return `<TimeSeries>
<mRID>1</mRID>
<auction.type>A01</auction.type>
<businessType>A62</businessType>
<in_Domain.mRID codingScheme="A01">${eic}</in_Domain.mRID>
<out_Domain.mRID codingScheme="A01">${eic}</out_Domain.mRID>
<contract_MarketAgreement.type>${contract}</contract_MarketAgreement.type>
<currency_Unit.name>${currency}</currency_Unit.name>
<price_Measure_Unit.name>${unit}</price_Measure_Unit.name>
<curveType>A03</curveType>
${sequence === undefined ? '' : `<classificationSequence_AttributeInstanceComponent.position>${sequence}</classificationSequence_AttributeInstanceComponent.position>`}
${periods.join('\n')}
</TimeSeries>`;
}

export function document(...timeSeries) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">
<mRID>64e2af3a87c2404cbea80edc067a1b6f</mRID>
<revisionNumber>1</revisionNumber>
<type>A44</type>
<sender_MarketParticipant.mRID codingScheme="A01">10X1001A1001A450</sender_MarketParticipant.mRID>
<createdDateTime>2026-10-16T11:00:00Z</createdDateTime>
<period.timeInterval>
<start>2026-10-15T22:00Z</start>
<end>2026-10-17T22:00Z</end>
</period.timeInterval>
${timeSeries.join('\n')}
</Publication_MarketDocument>`;
}

export function acknowledgement(
  code = '999',
  text = 'No matching data found for Data item Energy Prices',
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Acknowledgement_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-1:acknowledgementdocument:7:0">
<mRID>7a2c2f8e-6d5c-4b3a</mRID>
<createdDateTime>2026-10-16T08:00:00Z</createdDateTime>
<received_MarketDocument.createdDateTime>2026-10-16T08:00:00Z</received_MarketDocument.createdDateTime>
<Reason>
<code>${code}</code>
<text>${text}</text>
</Reason>
</Acknowledgement_MarketDocument>`;
}

/** A whole local day of quarter hours starting at `start`, `hours` long (23, 24 or 25). */
export const day = (start, { hours = 24, price, minutes = 15 } = {}) =>
  period({ start, minutes, count: (hours * 60) / minutes, price });
