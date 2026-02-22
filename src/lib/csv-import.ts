import { nanoid } from 'nanoid'

export type CsvTransaction = {
  id: string
  date: Date
  amount: number // absolute value in minor units (cents)
  rawAmount: number // original signed decimal from CSV
  isCredit: boolean
  description: string
  selected: boolean
}

export type CsvFormat =
  | 'wells-fargo'
  | 'chase'
  | 'bank-of-america'
  | 'capital-one'

export const CSV_FORMAT_LABELS: Record<CsvFormat, string> = {
  'wells-fargo': 'Wells Fargo',
  chase: 'Chase',
  'bank-of-america': 'Bank of America',
  'capital-one': 'Capital One',
}

export type CsvParseResult =
  | { success: true; transactions: CsvTransaction[]; detectedFormat: CsvFormat }
  | { success: false; error: string }

/**
 * Split a CSV line respecting quoted fields.
 * Handles fields like: "value with, comma","other"
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current.trim())
  return fields
}

function parseDate(dateStr: string): Date | null {
  // MM/DD/YYYY
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const [, month, day, year] = match
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    12,
    0,
    0,
  )
  if (isNaN(date.getTime())) return null
  return date
}

function toMinorUnits(decimal: number): number {
  return Math.round(Math.abs(decimal) * 100)
}

function makeTransaction(
  date: Date,
  rawAmount: number,
  description: string,
): CsvTransaction {
  const isCredit = rawAmount > 0
  return {
    id: nanoid(),
    date,
    amount: toMinorUnits(rawAmount),
    rawAmount,
    isCredit,
    description: description.trim(),
    selected: !isCredit,
  }
}

// --- Format detection ---

export function detectCsvFormat(text: string): CsvFormat | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return null

  const firstLine = lines[0].toLowerCase()

  // Chase: "Transaction Date,Post Date,Description,Category,Type,Amount"
  if (
    firstLine.includes('transaction date') &&
    firstLine.includes('post date') &&
    firstLine.includes('category') &&
    firstLine.includes('type')
  ) {
    return 'chase'
  }

  // Capital One: "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit"
  if (
    firstLine.includes('transaction date') &&
    firstLine.includes('posted date') &&
    firstLine.includes('debit') &&
    firstLine.includes('credit')
  ) {
    return 'capital-one'
  }

  // Bank of America: "Date,Description,Amount,Running Bal."
  if (
    firstLine.includes('date') &&
    firstLine.includes('description') &&
    firstLine.includes('running bal')
  ) {
    return 'bank-of-america'
  }

  // Wells Fargo: no header, 5 columns, all quoted, 3rd column is "*"
  const fields = splitCsvLine(lines[0])
  if (fields.length === 5 && fields[2] === '*') {
    return 'wells-fargo'
  }

  return null
}

// --- Format-specific parsers ---

function parseWellsFargo(lines: string[]): CsvParseResult {
  const transactions: CsvTransaction[] = []

  for (let i = 0; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    if (fields.length !== 5) {
      return {
        success: false,
        error: `Row ${i + 1}: Expected 5 columns but found ${fields.length}.`,
      }
    }

    const date = parseDate(fields[0])
    if (!date) {
      return {
        success: false,
        error: `Row ${i + 1}: Invalid date "${fields[0]}".`,
      }
    }

    const rawAmount = parseFloat(fields[1])
    if (isNaN(rawAmount)) {
      return {
        success: false,
        error: `Row ${i + 1}: Invalid amount "${fields[1]}".`,
      }
    }

    transactions.push(makeTransaction(date, rawAmount, fields[4]))
  }

  return { success: true, transactions, detectedFormat: 'wells-fargo' }
}

function parseChase(lines: string[]): CsvParseResult {
  // Skip header row
  const transactions: CsvTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    if (fields.length < 6) {
      return {
        success: false,
        error: `Row ${i + 1}: Expected at least 6 columns but found ${fields.length}.`,
      }
    }

    // Transaction Date is column 0
    const date = parseDate(fields[0])
    if (!date) {
      return {
        success: false,
        error: `Row ${i + 1}: Invalid date "${fields[0]}".`,
      }
    }

    // Amount is column 5 (negative = charge)
    const rawAmount = parseFloat(fields[5])
    if (isNaN(rawAmount)) {
      return {
        success: false,
        error: `Row ${i + 1}: Invalid amount "${fields[5]}".`,
      }
    }

    // Description is column 2
    transactions.push(makeTransaction(date, rawAmount, fields[2]))
  }

  return { success: true, transactions, detectedFormat: 'chase' }
}

function parseBankOfAmerica(lines: string[]): CsvParseResult {
  // Skip header row
  const transactions: CsvTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    if (fields.length < 3) {
      return {
        success: false,
        error: `Row ${i + 1}: Expected at least 3 columns but found ${fields.length}.`,
      }
    }

    // Date is column 0
    const date = parseDate(fields[0])
    if (!date) {
      return {
        success: false,
        error: `Row ${i + 1}: Invalid date "${fields[0]}".`,
      }
    }

    // Amount is column 2 (negative = charge)
    const rawAmount = parseFloat(fields[2])
    if (isNaN(rawAmount)) {
      return {
        success: false,
        error: `Row ${i + 1}: Invalid amount "${fields[2]}".`,
      }
    }

    // Description is column 1
    transactions.push(makeTransaction(date, rawAmount, fields[1]))
  }

  return { success: true, transactions, detectedFormat: 'bank-of-america' }
}

function parseCapitalOne(lines: string[]): CsvParseResult {
  // Skip header row
  const transactions: CsvTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    if (fields.length < 7) {
      return {
        success: false,
        error: `Row ${i + 1}: Expected at least 7 columns but found ${fields.length}.`,
      }
    }

    // Transaction Date is column 0
    const date = parseDate(fields[0])
    if (!date) {
      return {
        success: false,
        error: `Row ${i + 1}: Invalid date "${fields[0]}".`,
      }
    }

    // Debit is column 5, Credit is column 6
    const debit = parseFloat(fields[5])
    const credit = parseFloat(fields[6])
    const hasDebit = !isNaN(debit) && fields[5].trim() !== ''
    const hasCredit = !isNaN(credit) && fields[6].trim() !== ''

    if (!hasDebit && !hasCredit) {
      return {
        success: false,
        error: `Row ${i + 1}: No debit or credit amount found.`,
      }
    }

    // Normalize: debit as negative, credit as positive
    const rawAmount = hasDebit ? -Math.abs(debit) : Math.abs(credit)

    // Description is column 3
    transactions.push(makeTransaction(date, rawAmount, fields[3]))
  }

  return { success: true, transactions, detectedFormat: 'capital-one' }
}

// --- Main entry point ---

const parsers: Record<
  CsvFormat,
  (lines: string[]) => CsvParseResult
> = {
  'wells-fargo': parseWellsFargo,
  chase: parseChase,
  'bank-of-america': parseBankOfAmerica,
  'capital-one': parseCapitalOne,
}

export function parseCsv(text: string, format?: CsvFormat): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) {
    return { success: false, error: 'The file is empty.' }
  }

  const detectedFormat = format ?? detectCsvFormat(text)
  if (!detectedFormat) {
    return {
      success: false,
      error:
        'Could not detect the CSV format. Please select your bank format manually.',
    }
  }

  const result = parsers[detectedFormat](lines)

  if (result.success && result.transactions.length === 0) {
    return { success: false, error: 'No valid transactions found in the file.' }
  }

  return result
}

/**
 * Convert a parsed CSV transaction into the shape expected by expenseFormSchema.
 */
export function transactionToExpenseValues(
  tx: CsvTransaction,
  paidBy: string,
  participantIds: string[],
) {
  return {
    expenseDate: tx.date,
    title: tx.description,
    category: 0,
    amount: tx.amount,
    paidBy,
    paidFor: participantIds.map((id) => ({
      participant: id,
      shares: 1,
    })),
    splitMode: 'EVENLY' as const,
    isReimbursement: false,
    saveDefaultSplittingOptions: false,
    documents: [],
    notes: undefined,
    recurrenceRule: 'NONE' as const,
    originalAmount: undefined,
    originalCurrency: '',
    conversionRate: undefined,
  }
}
