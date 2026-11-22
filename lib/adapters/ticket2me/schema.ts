import { z } from "zod";

const seatCellSchema = z.object({
  ticket_id: z.number(),
  seat_id: z.number(),
  seat_no: z.string(),
  status: z.union([z.literal(0), z.literal(2), z.literal(-1)]),
});

export const t2mWireSchema = z.object({
  success: z.boolean(),
  status: z.string(),
  data: z.object({
    attributes: z.array(
      z.object({
        rowNumber: z.number(),
        seats: z.array(seatCellSchema),
      }),
    ),
  }),
});

export const t2mTicketsSchema = z.object({
  success: z.boolean(),
  status: z.string(),
  data: z.object({
    tickets: z.array(
      z.object({
        id: z.number(),
        title: z.string(),
        price: z.string(),
        color: z.string(),
      }),
    ),
  }),
});
