const JSON_LD_ESCAPE_LOOKUP: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function serializeStructuredData(data: object) {
  return JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (character) => JSON_LD_ESCAPE_LOOKUP[character]
  );
}

export default function StructuredData({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(data) }}
    />
  );
}
