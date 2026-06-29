import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('watch_lists')
export class WatchList {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId: number | null;

  @Column()
  name: string;

  @Column({ name: 'board_type', type: 'varchar' })
  boardType: 'stock' | 'fund';

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
