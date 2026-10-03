import React from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
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
