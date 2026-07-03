import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'smtp_host', type: 'varchar', nullable: true })
  smtpHost: string | null;

  @Column({ name: 'smtp_port', type: 'int', nullable: true })
  smtpPort: number | null;

  @Column({ name: 'smtp_secure', type: 'boolean', nullable: true })
  smtpSecure: boolean | null;

  @Column({ name: 'smtp_user', type: 'varchar', nullable: true })
  smtpUser: string | null;

  @Column({ name: 'smtp_pass', type: 'varchar', nullable: true })
  smtpPass: string | null;

  @Column({ name: 'smtp_to', type: 'varchar', nullable: true })
  smtpTo: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
