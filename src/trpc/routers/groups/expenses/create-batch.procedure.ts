import { getGroup, logActivity, randomId } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { expenseFormSchema } from '@/lib/schemas'
import { ActivityType } from '@prisma/client'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const createBatchGroupExpenseProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenses: z.array(expenseFormSchema).min(1).max(500),
      participantId: z.string().optional(),
    }),
  )
  .mutation(
    async ({ input: { groupId, expenses, participantId } }) => {
      const group = await getGroup(groupId)
      if (!group) throw new Error(`Invalid group ID: ${groupId}`)

      // Validate all participant IDs once
      const validParticipantIds = new Set(group.participants.map((p) => p.id))
      for (const expense of expenses) {
        if (!validParticipantIds.has(expense.paidBy)) {
          throw new Error(`Invalid participant ID: ${expense.paidBy}`)
        }
        for (const pf of expense.paidFor) {
          if (!validParticipantIds.has(pf.participant)) {
            throw new Error(`Invalid participant ID: ${pf.participant}`)
          }
        }
      }

      // Create all expenses in a single transaction
      const results = await prisma.$transaction(
        expenses.map((expenseFormValues) => {
          const expenseId = randomId()
          return prisma.expense.create({
            data: {
              id: expenseId,
              groupId,
              expenseDate: expenseFormValues.expenseDate,
              categoryId: expenseFormValues.category,
              amount: expenseFormValues.amount,
              title: expenseFormValues.title,
              paidById: expenseFormValues.paidBy,
              splitMode: expenseFormValues.splitMode,
              recurrenceRule: expenseFormValues.recurrenceRule,
              paidFor: {
                createMany: {
                  data: expenseFormValues.paidFor.map((paidFor) => ({
                    participantId: paidFor.participant,
                    shares: paidFor.shares,
                  })),
                },
              },
              isReimbursement: expenseFormValues.isReimbursement,
              notes: expenseFormValues.notes,
            },
          })
        }),
      )

      // Log a single activity for the batch import
      await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
        participantId,
        data: `Imported ${results.length} expenses from CSV`,
      })

      return { count: results.length }
    },
  )
