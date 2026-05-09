import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('favorites')
export class Favorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  code: string;

  @Column()
  market: string;

  @Column()
  name: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ default: false })
  pinned: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
