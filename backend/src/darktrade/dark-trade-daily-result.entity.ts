import { Column, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/** 每只股票每天的最新明暗盘结果，供挖掘页直接筛选。 */
@Entity('dark_trade_daily_result')
@Unique(['tradeDate', 'code'])
@Index(['tradeDate', 'darkCapital'])
export class DarkTradeDailyResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'trade_date' })
  tradeDate: string;

  @Column()
  code: string;

  @Column({ name: 'capture_minute' })
  captureMinute: string;

  @Column({ name: 'dark_capital', type: 'double', nullable: true })
  darkCapital: number | null;

  @Column({ name: 'light_capital', type: 'double', nullable: true })
  lightCapital: number | null;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ name: 'latest_price', type: 'float', nullable: true })
  latestPrice: number | null;

  @Column({ name: 'change_pct', type: 'float', nullable: true })
  changePct: number | null;

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
