"""Independent arithmetic specification for the six-entry household cycles."""
from datetime import date,timedelta
from pathlib import Path
import json
names=['Groceries and household supplies','Utilities and internet','Auto and life insurance','Fuel and transportation','Dining and entertainment',"School and children's activities",'Household subscriptions','Medical and dental','Vehicle maintenance','Property insurance']
categories={n:0 for n in names};years={};beneficiaries={n:0 for n in ['Alex Morgan','Jamie Morgan','Emma Morgan','Noah Morgan']}
for group in range(51282):
 day=date(2010,1,1)+timedelta(days=group%5844);cycle=group//5844
 for purchase in range(4):
  cents=1000+((37*group+191*purchase)%9000)
  category=names[(7*group+3*purchase+cycle)%10]
  beneficiary=list(beneficiaries)[(group+cycle+purchase)%(2 if day<date(2018,1,1) else 4)]
  categories[category]+=cents;beneficiaries[beneficiary]+=cents;years[str(day.year)]=years.get(str(day.year),0)+cents
result={'journals':308000,'historicalJournals':307692,'groups':51282,'historicalIncomeMinor':sum(categories.values()),'historicalExpenseMinor':sum(categories.values()),'historicalNetMinor':0,'categoriesMinor':categories,'yearsMinor':years,'beneficiariesMinor':beneficiaries,'householdCashAt2026_09_16':'95719.77','allBookCashAt2026_09_16':'164985.32','cardBalancesAt2026_09_16':{'Cedar Visa':'1804.00','Harbor Mastercard':'329.97'}}
p=Path(__file__).resolve().parents[2]/'.convex/query-evaluation/diverse-oracle.json';p.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
