/**
 * ReportModel → .docx. Pure render: every display string arrives on the model.
 * Client-facing artifact style: ink on paper — deepwater header bars, steel
 * body ink, no accent color anywhere.
 */
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type {
  ReportCostMatrix,
  ReportCostMatrixCell,
  ReportModel,
  ReportPlanBenefits,
} from "@rxsr/core/report-model";

const DEEPWATER = "0E1D2F";
const INK = "16202C";
const STEEL = "44505E";
const RULE = "B9C0C9";
const FOG = "EEF1F4";
/** Word substitutes Arial/system sans when these fonts are not installed. */
const BODY_FONT = "Public Sans";
const DATA_FONT = "IBM Plex Mono";

const CELL_MARGINS = { top: 80, bottom: 80, left: 110, right: 110 };

const rule = { style: BorderStyle.SINGLE, size: 4, color: RULE } as const;
const TABLE_BORDERS = {
  top: rule,
  bottom: rule,
  left: rule,
  right: rule,
  insideHorizontal: rule,
  insideVertical: rule,
};

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  color?: string;
  size?: number;
}

const bodyRun = (text: string, opts: RunOpts = {}): TextRun =>
  new TextRun({ text, font: BODY_FONT, color: INK, size: 20, ...opts });

const dataRun = (text: string, opts: RunOpts = {}): TextRun =>
  new TextRun({ text, font: DATA_FONT, color: INK, size: 18, ...opts });

function headerCell(text: string, columnSpan?: number): TableCell {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, fill: DEEPWATER, color: "auto" },
    columnSpan,
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGINS,
    children: [
      new Paragraph({ children: [bodyRun(text, { bold: true, color: "FFFFFF", size: 18 })] }),
    ],
  });
}

function subheadCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, fill: FOG, color: "auto" },
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [bodyRun(text, { bold: true, size: 16, color: STEEL })] })],
  });
}

function labelCell(text: string, opts: RunOpts = {}): TableCell {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [bodyRun(text, { size: 18, ...opts })] })],
  });
}

function dataCell(text: string, columnSpan?: number, opts: RunOpts = {}): TableCell {
  return new TableCell({
    columnSpan,
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [dataRun(text, opts)] })],
  });
}

const spacer = (): Paragraph => new Paragraph({ children: [], spacing: { after: 160 } });

const sectionTitle = (text: string): Paragraph =>
  new Paragraph({
    children: [bodyRun(text, { bold: true, size: 24, color: DEEPWATER })],
    spacing: { before: 260, after: 120 },
  });

function matrixCell(cell: ReportCostMatrixCell): TableCell {
  const children: Paragraph[] = [
    new Paragraph({
      children: [
        dataRun(cell.display, {
          bold: cell.cheapest,
          italics: cell.unavailable,
          color: cell.unavailable ? STEEL : INK,
        }),
      ],
    }),
  ];
  if (!cell.unavailable) {
    children.push(
      new Paragraph({
        children: [
          bodyRun(cell.cheapest ? `${cell.channelLabel} · Best` : cell.channelLabel, {
            size: 14,
            color: STEEL,
            bold: cell.cheapest,
          }),
        ],
      }),
    );
  }
  return new TableCell({
    shading: cell.cheapest ? { type: ShadingType.CLEAR, fill: FOG, color: "auto" } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGINS,
    children,
  });
}

function costMatrixTable(matrix: ReportCostMatrix, planNames: string[]): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [headerCell("Your Pharmacy"), ...planNames.map((name) => headerCell(name))],
  });
  const rows = matrix.rows.map(
    (row) =>
      new TableRow({
        children: [labelCell(row.label, { bold: true }), ...row.cells.map(matrixCell)],
      }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [header, ...rows],
  });
}

function gridTable(model: ReportModel): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [headerCell("Medication"), ...model.planNames.map((name) => headerCell(name))],
  });
  const rows = model.grid.map(
    (row) =>
      new TableRow({
        children: [
          labelCell(row.medicationName),
          ...row.cells.map((cell) =>
            dataCell(cell.display, undefined, {
              color:
                cell.coverage === "not_on_formulary" || cell.coverage === "not_covered"
                  ? STEEL
                  : INK,
              italics: cell.coverage === "not_on_formulary" || cell.coverage === "not_covered",
            }),
          ),
        ],
      }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [header, ...rows],
  });
}

function benefitsTable(benefits: ReportPlanBenefits): Table {
  const valueColumns = Math.max(benefits.channelHeaders.length, 1);
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [headerCell(`${benefits.carrierName} — ${benefits.planName}`, valueColumns + 1)],
    }),
    new TableRow({
      children: [labelCell("Plan Premium"), dataCell(benefits.premium, valueColumns)],
    }),
    new TableRow({
      children: [labelCell("RX Deductible"), dataCell(benefits.rxDeductible, valueColumns)],
    }),
    new TableRow({
      children: [subheadCell("Tier"), ...benefits.channelHeaders.map((h) => subheadCell(h))],
    }),
    ...benefits.tierRows.map(
      (tierRow) =>
        new TableRow({
          children: [
            labelCell(tierRow.label),
            ...tierRow.values.map((value) => dataCell(value)),
          ],
        }),
    ),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows,
  });
}

export function buildDocument(model: ReportModel): Document {
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      children: [bodyRun(`Prescription Drug Plan Analysis — ${model.clientName}`, { bold: true, size: 32, color: DEEPWATER })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        bodyRun(
          `Prepared by ${model.preparedBy} · ${model.agencyName} · Plan year ${model.planYear} · ${model.preparedDate}`,
          { size: 16, color: STEEL },
        ),
      ],
      spacing: { after: 240 },
    }),
  );

  for (const note of model.pharmacyNotes) {
    children.push(
      new Paragraph({ children: [bodyRun(note, { italics: true, size: 18 })], spacing: { after: 80 } }),
    );
  }

  if (model.agentNotes.trim().length > 0) {
    for (const line of model.agentNotes.split(/\r?\n/)) {
      children.push(
        new Paragraph({ children: [bodyRun(line, { size: 18 })], spacing: { after: 80 } }),
      );
    }
  }

  children.push(sectionTitle("Coverage by Plan"), gridTable(model));

  if (model.costMatrix && model.costMatrix.rows.length > 0) {
    children.push(
      sectionTitle("Estimated Monthly Cost by Pharmacy"),
      costMatrixTable(model.costMatrix, model.planNames),
    );
    if (model.costMatrix.note) {
      children.push(
        new Paragraph({
          children: [bodyRun(model.costMatrix.note, { italics: true, size: 14, color: STEEL })],
          spacing: { before: 80 },
        }),
      );
    }
  }

  children.push(sectionTitle("Plan Benefits"));
  for (const benefits of model.benefits) {
    children.push(spacer(), benefitsTable(benefits));
  }

  if (model.deductibleFootnote) {
    children.push(
      spacer(),
      new Paragraph({
        children: [bodyRun(model.deductibleFootnote, { italics: true, size: 16, color: STEEL })],
      }),
    );
  }

  if (model.disclaimers.length > 0) {
    children.push(
      new Paragraph({
        children: [bodyRun("Important disclosures", { bold: true, size: 16, color: STEEL })],
        spacing: { before: 240, after: 60 },
      }),
    );
    for (const disclaimer of model.disclaimers) {
      children.push(
        new Paragraph({
          children: [bodyRun(disclaimer, { size: 14, color: STEEL })],
          spacing: { after: 80 },
        }),
      );
    }
  }

  return new Document({
    creator: model.agencyName,
    title: `Prescription Drug Plan Analysis — ${model.clientName}`,
    styles: {
      default: { document: { run: { font: BODY_FONT, size: 20, color: INK } } },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } },
        },
        children,
      },
    ],
  });
}

export async function renderDocx(model: ReportModel): Promise<Buffer> {
  return Packer.toBuffer(buildDocument(model));
}
