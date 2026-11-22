import type { T2mWireResponse } from "../../rules/import-map";

/** Fictional Harbor Lights plan: aisle, EMPTY cells sharing seat_id 0, whole empty row. */
export const DEMO_SEAT_PLAN: T2mWireResponse = {
  success: true,
  status: "ok",
  data: {
    attributes: [
      {
        rowNumber: 1,
        seats: [
          { ticket_id: 101, seat_id: 1001, seat_no: "C1", status: 0 },
          { ticket_id: 101, seat_id: 1002, seat_no: "C2", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 101, seat_id: 1004, seat_no: "C4", status: 2 },
          { ticket_id: 101, seat_id: 1005, seat_no: "C5", status: -1 },
        ],
      },
      {
        rowNumber: 2,
        seats: [
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
        ],
      },
      {
        rowNumber: 3,
        seats: [
          { ticket_id: 102, seat_id: 1101, seat_no: "B1", status: -1 },
          { ticket_id: 102, seat_id: 1102, seat_no: "B2", status: 0 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 102, seat_id: 1104, seat_no: "B4", status: -1 },
          { ticket_id: 102, seat_id: 1105, seat_no: "B5", status: 2 },
        ],
      },
    ],
  },
};
