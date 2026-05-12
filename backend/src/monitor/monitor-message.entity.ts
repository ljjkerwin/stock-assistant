import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('monitor_messages')
export class MonitorMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  ruleId!: number;

  @Column()
  stockCode!: string;

  @Column()
  stockMarket!: string;

  @Column()
  stockName!: string;

  @Column()
  type!: string;

  @Column({ type: 'real' })
  currentPrice!: number;

  @Column({ type: 'real' })
  targetValue!: number;

  @Column({ type: 'text', nullable: true })
  maPeriod!: string | null;

  @Column({ type: 'integer' })
  triggeredAt!: number;
}
