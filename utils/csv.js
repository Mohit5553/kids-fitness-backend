export const toCsv = (rows, headers) => {
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = headers.map((h) => escape(h.label)).join(',');
  const lines = rows.map((row) => headers.map((h) => escape(row[h.key])).join(','));
  return [headerLine, ...lines].join('\n');
};
