import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('dark_trade_index')
export class DarkTradeIndex {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  code: string;

  @Column({ name: 'page_num' })
  pageNum: number;

  @Column({ name: 'index_in_page' })
  indexInPage: number;

  @Column({ name: 'refresh_date' })
  refreshDate: string;

  @Column({ name: 'sort_flag', default: 6 })
  sortFlag: number;

  @Column({ name: 'sort_desc', type: 'int', default: 1 })
  sortDesc: number;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ name: 'latest_price', type: 'float', nullable: true })
  latestPrice: number | null;

  @Column({ name: 'change_pct', type: 'float', nullable: true })
  changePct: number | null;

  @Column({ name: 'dark_capital', type: 'double', nullable: true })
  darkCapital: number | null;

  @Column({ name: 'light_capital', type: 'double', nullable: true })
  lightCapital: number | null;

  @Column({ name: 'net_inflow', type: 'double', nullable: true })
  netInflow: number | null;

  @Column({ name: 'dark_activity', type: 'float', nullable: true })
  darkActivity: number | null;

  @Column({ type: 'text', nullable: true })
  sector: string | null;

  @Column({ type: 'text', nullable: true })
  concept: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
