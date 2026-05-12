import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('monitor_rules')
export class MonitorRule {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  stockCode!: string;

  @Column()
  stockMarket!: string;

  @Column()
  stockName!: string;

  /** 'price_above' | 'price_below' | 'ma_cross_above' | 'ma_cross_below' */
  @Column()
  type!: string;

  @Column({ type: 'real', nullable: true })
  targetPrice!: number | null;

  /** 'ma5' | 'ma10' | 'ma20' */
  @Column({ type: 'text', nullable: true })
  maPeriod!: string | null;

  @Column({ default: true })
  active!: boolean;

  /** ms 时间戳，上次触发时间；null 表示从未触发 */
  @Column({ type: 'integer', nullable: true })
  lastTriggeredAt!: number | null;

  /** MA 穿越规则：上一次轮询时价格是否在均线上方；null 表示尚未初始化 */
  @Column({ type: 'boolean', nullable: true })
  prevAboveMA!: boolean | null;

  @Column({ type: 'integer' })
  createdAt!: number;
}
