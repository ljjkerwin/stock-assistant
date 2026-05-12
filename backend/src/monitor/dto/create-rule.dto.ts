export class CreateRuleDto {
  stockCode!: string;
  stockMarket!: string;
  stockName!: string;
  type!: string;
  targetPrice?: number;
  maPeriod?: string;
}
