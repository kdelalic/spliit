'use client'

import {
  type CsvFormat,
  type CsvTransaction,
  CSV_FORMAT_LABELS,
  parseCsv,
  transactionToExpenseValues,
} from '@/lib/csv-import'
import { useActiveUser, useMediaQuery } from '@/lib/hooks'
import { formatCurrency, getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/components/ui/use-toast'
import { AlertCircle, Loader2, Upload } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { PropsWithChildren, ReactNode, useRef, useState } from 'react'
import { useCurrentGroup } from '../current-group-context'

type ImportStep = 'upload' | 'preview' | 'importing'

export function ImportCsvButton() {
  const t = useTranslations('ImportCsv')
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [open, setOpen] = useState(false)

  const content = <ImportDialogContent onDone={() => setOpen(false)} />

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="icon" variant="secondary" title={t('triggerTitle')}>
            <Upload className="w-4 h-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('Dialog.title')}</DialogTitle>
            <DialogDescription>{t('Dialog.description')}</DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="icon" variant="secondary" title={t('triggerTitle')}>
          <Upload className="w-4 h-4" />
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('Dialog.title')}</DrawerTitle>
          <DrawerDescription>{t('Dialog.description')}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-4 max-h-[70vh] flex flex-col">{content}</div>
      </DrawerContent>
    </Drawer>
  )
}

function ImportDialogContent({ onDone }: { onDone: () => void }) {
  const { group, groupId } = useCurrentGroup()
  const t = useTranslations('ImportCsv')
  const locale = useLocale()
  const { toast } = useToast()
  const utils = trpc.useUtils()

  const [step, setStep] = useState<ImportStep>('upload')
  const [transactions, setTransactions] = useState<CsvTransaction[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [detectedFormat, setDetectedFormat] = useState<CsvFormat | null>(null)
  const [manualFormat, setManualFormat] = useState<CsvFormat | undefined>(
    undefined,
  )
  const [paidBy, setPaidBy] = useState<string>('')
  const [rawCsvText, setRawCsvText] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeUserId = useActiveUser(groupId)

  // Set default paidBy from active user
  if (
    paidBy === '' &&
    activeUserId &&
    activeUserId !== 'None' &&
    group?.participants.some((p) => p.id === activeUserId)
  ) {
    setPaidBy(activeUserId)
  }

  const createBatch = trpc.groups.expenses.createBatch.useMutation({
    onSuccess: (data) => {
      utils.groups.expenses.list.invalidate()
      toast({
        title: t('SuccessToast.title'),
        description: t('SuccessToast.description', { count: data.count }),
      })
      onDone()
    },
    onError: () => {
      setStep('preview')
      toast({
        title: t('ErrorToast.title'),
        description: t('ErrorToast.description'),
        variant: 'destructive',
      })
    },
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setRawCsvText(text)
      attemptParse(text, manualFormat)
    }
    reader.readAsText(file)
    // Reset so re-selecting the same file triggers onChange
    e.target.value = ''
  }

  const attemptParse = (text: string, format?: CsvFormat) => {
    const result = parseCsv(text, format)
    if (result.success) {
      setTransactions(result.transactions)
      setDetectedFormat(result.detectedFormat)
      setParseError(null)
      setStep('preview')
    } else {
      setParseError(result.error)
      setTransactions([])
      setDetectedFormat(null)
    }
  }

  const handleFormatChange = (format: string) => {
    if (format === 'auto') {
      setManualFormat(undefined)
      if (rawCsvText) attemptParse(rawCsvText, undefined)
    } else {
      const f = format as CsvFormat
      setManualFormat(f)
      if (rawCsvText) attemptParse(rawCsvText, f)
    }
  }

  const toggleTransaction = (id: string) => {
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === id ? { ...tx, selected: !tx.selected } : tx,
      ),
    )
  }

  const selectAll = () =>
    setTransactions((prev) => prev.map((tx) => ({ ...tx, selected: true })))
  const deselectAll = () =>
    setTransactions((prev) => prev.map((tx) => ({ ...tx, selected: false })))
  const chargesOnly = () =>
    setTransactions((prev) =>
      prev.map((tx) => ({ ...tx, selected: !tx.isCredit })),
    )

  const selectedTxs = transactions.filter((tx) => tx.selected)
  const totalCents = selectedTxs.reduce((sum, tx) => sum + tx.amount, 0)

  const handleImport = () => {
    if (!group || selectedTxs.length === 0 || !paidBy) return
    setStep('importing')

    const participantIds = group.participants.map((p) => p.id)
    const expenses = selectedTxs.map((tx) =>
      transactionToExpenseValues(tx, paidBy, participantIds),
    )

    createBatch.mutate({
      groupId,
      expenses,
      participantId: activeUserId ?? undefined,
    })
  }

  const currency = group ? getCurrencyFromGroup(group) : null

  const formatTotal = (cents: number) => {
    if (!currency) return ''
    return formatCurrency(currency, cents, locale)
  }

  const formatTxAmount = (tx: CsvTransaction) => {
    if (!currency) return ''
    return formatCurrency(currency, tx.amount, locale)
  }

  const formatTxDate = (date: Date) => {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)
  }

  if (step === 'upload') {
    return (
      <div className="flex flex-col gap-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-sm font-medium mb-1.5 block">
              {t('Dialog.formatLabel')}
            </label>
            <Select
              value={manualFormat ?? 'auto'}
              onValueChange={handleFormatChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('Dialog.formatAuto')}</SelectItem>
                {(
                  Object.entries(CSV_FORMAT_LABELS) as [CsvFormat, string][]
                ).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            {t('Dialog.selectFile')}
          </Button>
        </div>

        {parseError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('ParseError.title')}</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  if (step === 'importing') {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('Dialog.importing')}</p>
      </div>
    )
  }

  // Preview step
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-end">
          {group && (
            <div className="flex-1">
              <label className="text-sm font-medium mb-1.5 block">
                {t('Dialog.paidByLabel')}
              </label>
              <Select value={paidBy} onValueChange={setPaidBy}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t('Dialog.paidByPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {group.participants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {detectedFormat && (
          <p className="text-xs text-muted-foreground">
            Detected format: {CSV_FORMAT_LABELS[detectedFormat]}
          </p>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t('Dialog.summary', {
              selected: selectedTxs.length,
              total: transactions.length,
            })}
            {' — '}
            {t('Dialog.totalAmount', { amount: formatTotal(totalCents) })}
          </p>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              className="underline text-muted-foreground hover:text-foreground"
              onClick={selectAll}
            >
              {t('Dialog.selectAll')}
            </button>
            <button
              type="button"
              className="underline text-muted-foreground hover:text-foreground"
              onClick={deselectAll}
            >
              {t('Dialog.deselectAll')}
            </button>
            <button
              type="button"
              className="underline text-muted-foreground hover:text-foreground"
              onClick={chargesOnly}
            >
              {t('Dialog.chargesOnly')}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-auto flex-1 min-h-0 border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="w-24">{t('Dialog.date')}</TableHead>
              <TableHead>{t('Dialog.merchant')}</TableHead>
              <TableHead className="text-right w-24">
                {t('Dialog.amount')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => (
              <TableRow
                key={tx.id}
                className={tx.isCredit ? 'opacity-50' : ''}
              >
                <TableCell>
                  <Checkbox
                    checked={tx.selected}
                    onCheckedChange={() => toggleTransaction(tx.id)}
                  />
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {formatTxDate(tx.date)}
                </TableCell>
                <TableCell className="text-sm">
                  {tx.description}
                  {tx.isCredit && (
                    <span className="ml-1 text-xs text-green-600 dark:text-green-400">
                      ({t('Dialog.credit')})
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {formatTxAmount(tx)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button
          variant="outline"
          onClick={() => {
            setStep('upload')
            setTransactions([])
            setParseError(null)
          }}
        >
          {t('Dialog.changeFile')}
        </Button>
        <Button
          disabled={selectedTxs.length === 0 || !paidBy}
          onClick={handleImport}
        >
          {selectedTxs.length > 0
            ? t('Dialog.import', { count: selectedTxs.length })
            : t('Dialog.noTransactionsSelected')}
        </Button>
      </div>
    </>
  )
}
