import type { Seat, SeatStatus, T2mStatus } from "../rules/seats";

type DbSeat = {
  id: string;
  showbuy_id: string;
  section_id: string;
  row_label: string;
  seat_number: number;
  grid_row: number;
  position: number;
  status: string;
  t2m_status: string;
  conflict: string | null;
};

export function mapDbSeat(row: DbSeat): Seat {
  return {
    id: row.id,
    showbuyId: row.showbuy_id,
    sectionId: row.section_id,
    row: row.row_label,
    number: row.seat_number,
    label: `${row.row_label}${row.seat_number}`,
    gridRow: row.grid_row,
    position: row.position,
    status: row.status as SeatStatus,
    t2mStatus: row.t2m_status as T2mStatus,
    conflict: row.conflict,
  };
}
