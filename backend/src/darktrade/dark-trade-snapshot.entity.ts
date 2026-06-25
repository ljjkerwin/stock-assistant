import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Unique } from 'typeorm';

@Entity('dark_trade_snapshot')
@Unique(['code', 'captureMinute'])
export class DarkTradeSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  code: string;

  /** YYYYMMDD — 用于按日期区间过滤 */
  @Column({ name: 'trade_date' })
  tradeDate: string;

  /** YYYYMMDDHHMM（北京时间）— 分钟级去重唯一键 */
  @Column({ name: 'capture_minute' })
  captureMinute: string;

  @Column({ name: 'dark_capital', type: 'double', nullable: true })
  darkCapital: number | null;

  @Column({ name: 'light_capital', type: 'double', nullable: true })
  lightCapital: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
