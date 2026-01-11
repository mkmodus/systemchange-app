import { TranscriptionSegment } from '../types';

export const downloadCsv = (segments: TranscriptionSegment[]) => {
  if (segments.length === 0) return;

  // Extract just the text.
  // Escape double quotes by doubling them (CSV standard).
  // Wrap in quotes to handle commas and newlines correctly.
  const csvRows = segments.map(seg => {
    const safeText = seg.text.replace(/"/g, '""');
    return `"${safeText}"`;
  });

  // Add BOM (\uFEFF) so Excel/Google Sheets open UTF-8 characters (Korean) correctly without garbling.
  const csvContent = '\uFEFF' + csvRows.join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  const now = new Date();
  // Format: YYYY-MM-DD_HH-mm-ss
  const timestamp = now.toISOString().replace(/T/, '_').replace(/[:.]/g, '-').slice(0, 19);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `2026_forum_transcript_${timestamp}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};