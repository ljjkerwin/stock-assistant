import { Entity, PrimaryGeneratedColumn, Column, ValueTransformer } from 'typeorm';

const bigintCol: ValueTransformer = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

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

  @Column({ type: 'double' })
  currentPrice!: number;

  @Column({ type: 'double' })
  targetValue!: number;

  @Column({ type: 'text', nullable: true })
  maPeriod!: string | null;

  @Column({ type: 'bigint', transformer: bigintCol })
  triggeredAt!: number;

  @Column({ default: false })
  read!: boolean;
}
