import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, FileText, X } from 'lucide-react';
import type { AgentDocument } from '../lib/agentDocument';

export const AgentDocumentCard: React.FC<{
  document: AgentDocument;
  language: string;
  onDownload: (document: AgentDocument) => void;
}> = ({ document, language, onDownload }) => (
  <div className="w-full space-y-3 text-left">
    <div className="flex items-center gap-2 font-bold text-brand-700 dark:text-brand-300">
      {document.format === 'xlsx' ? <FileSpreadsheet size={20} /> : <FileText size={20} />}
      <span>{document.title}</span>
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400">
      {language === 'km' ? 'មើលឯកសារខាងក្រោម ហើយទាញយកបើត្រឹមត្រូវ។' : 'Review the document below, then download it.'}
    </p>
    {document.format === 'docx' ? (
      <div className="max-h-80 overflow-y-auto rounded-xl bg-white/70 p-3 text-sm dark:bg-slate-900/60">
        {document.sections?.map((section, sectionIndex) => <div key={sectionIndex} className="mb-3">
          {section.heading && <p className="font-semibold">{section.heading}</p>}
          {section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex} className="mt-1 whitespace-pre-wrap">{paragraph}</p>)}
        </div>)}
      </div>
    ) : (
      <div className="max-h-80 overflow-auto rounded-xl bg-white/70 p-3 text-sm dark:bg-slate-900/60">
        {document.sheets?.map((sheet, sheetIndex) => <div key={sheetIndex} className="mb-3">
          <p className="mb-1 font-semibold">{sheet.name}</p>
          <table className="min-w-full border-collapse text-left"><thead><tr>{sheet.columns.map((column, columnIndex) => <th key={columnIndex} className="border border-slate-300 px-2 py-1">{column}</th>)}</tr></thead>
            <tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border border-slate-300 px-2 py-1">{cell}</td>)}</tr>)}</tbody></table>
        </div>)}
      </div>
    )}
    <button type="button" onClick={() => onDownload(document)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 font-bold text-white">
      <Download size={16} /> {language === 'km' ? 'ទាញយកឯកសារ' : 'Download document'}
    </button>
  </div>
);

export const AgentDocumentDialog: React.FC<{
  document: AgentDocument;
  language: string;
  onDownload: (document: AgentDocument) => void;
  onClose: () => void;
}> = ({ document, language, onDownload, onClose }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const dialog = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6">
      <div role="dialog" aria-modal="true" aria-label={language === 'km' ? 'ឯកសាររួចរាល់សម្រាប់ទាញយក' : 'Document ready to download'} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-brand-200 bg-white p-5 shadow-2xl dark:border-slate-600 dark:bg-slate-800 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-brand-700 dark:text-brand-300">
            {language === 'km' ? 'ឯកសាររួចរាល់ — មើល និងទាញយក' : 'Document ready — review and download'}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => onDownload(document)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold text-white">
              <Download size={16} /> {language === 'km' ? 'ទាញយក' : 'Download'}
            </button>
            <button type="button" onClick={onClose} aria-label={language === 'km' ? 'បិទផ្ទាំងឯកសារ' : 'Close document preview'} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
              <X size={20} />
            </button>
          </div>
        </div>
        <AgentDocumentCard document={document} language={language} onDownload={onDownload} />
      </div>
    </div>
  );
  return typeof window === 'undefined' ? dialog : createPortal(dialog, window.document.body);
};
