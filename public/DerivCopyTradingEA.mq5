#property strict
#property version "1.03"
#property description "One MT5 master / up to 50 hedging followers. No credentials for the trading account leave MT5."
#include <Trade/Trade.mqh>
enum CopyRole { MASTER=0, SLAVE=1 };
input CopyRole Role=MASTER;
input string ApiBaseUrl="https://derivbot-qnwz.onrender.com";
input string AgentId="";
input string AgentKey="";
input bool AllowRealTrading=false;
input int PollSeconds=2;
input double TerminalMaxLot=1.0;
input double TerminalMaxTotalLots=5.0;
input double TerminalLossLimitPercent=10.0;
input int DeviationPoints=20;
CTrade copier;
string sessionId="", ackId="", ackStatus="", ackMessage="", ackCode="";
long sequence=0;
double startingEquity=0;
int lockHandle=INVALID_HANDLE;
bool busy=false;
string effectiveAgentId="", effectiveAgentKey="", effectiveApiUrl="";

string TrimInput(string value){StringTrimLeft(value);StringTrimRight(value);return value;}
// Accept one labelled line from the old clipboard button, never a whole credentials block.
string CredentialInput(string value,string name){
 value=TrimInput(value);
 if(StringFind(value,name+"=")==0)value=TrimInput(StringSubstr(value,StringLen(name)+1));
 return value;
}
int InvalidParameter(string message){
 Print("CopyTrading 1.03 : ",message);
 Alert("CopyTrading : ",message,"\nCorrigez les données d’entrée puis rattachez l’EA.");
 return INIT_PARAMETERS_INCORRECT;
}
bool HexKey(string value){
 if(StringLen(value)!=64)return false;
 for(int i=0;i<64;i++){ushort c=StringGetCharacter(value,i);if(!((c>=48&&c<=57)||(c>=97&&c<=102)))return false;}
 return true;
}

string Esc(string value){StringReplace(value,"\\","\\\\");StringReplace(value,"\"","\\\"");StringReplace(value,"\r"," ");StringReplace(value,"\n"," ");StringReplace(value,"\t"," ");return value;}
string Str(string json,string key){
 int at=StringFind(json,"\""+key+"\"");if(at<0)return "";
 at=StringFind(json,":",at);if(at<0)return "";at++;
 while(at<StringLen(json)&&StringGetCharacter(json,at)<=32)at++;
 if(StringGetCharacter(json,at)!=34)return "";at++;
 string out="";bool escaped=false;
 for(;at<StringLen(json);at++){
  ushort ch=StringGetCharacter(json,at);
  if(escaped){if(ch==110||ch==114||ch==116)out+=" ";else out+=ShortToString(ch);escaped=false;}
  else if(ch==92)escaped=true;else if(ch==34)return out;else out+=ShortToString(ch);
 }
 return "";
}
double Num(string json,string key){
 int at=StringFind(json,"\""+key+"\"");if(at<0)return -1;
 at=StringFind(json,":",at)+1;while(at<StringLen(json)&&StringGetCharacter(json,at)<=32)at++;
 int end=at;while(end<StringLen(json)){ushort ch=StringGetCharacter(json,end);if((ch>=48&&ch<=57)||ch==46||ch==45||ch==43||ch==101||ch==69)end++;else break;}
 if(end==at)return -1;return StringToDouble(StringSubstr(json,at,end-at));
}
bool SafeId(string value){
 if(StringLen(value)!=36)return false;
 for(int i=0;i<StringLen(value);i++){ushort c=StringGetCharacter(value,i);if(!((c>=48&&c<=57)||(c>=97&&c<=102)||c==45))return false;}return true;
}
string Account(){return IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));}
string Mode(){return AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO?"demo":"real";}
string Prefix(){return "Copy_"+effectiveAgentId+"_"+Account()+"_";}
string Positions(double &floatingPnl){
 floatingPnl=0;
 string result="[";int count=0,total=PositionsTotal();
 for(int i=0;i<total;i++){
  ulong ticket=PositionGetTicket(i);if(ticket==0)return "";
  if(count++>0)result+=",";
  double profit=PositionGetDouble(POSITION_PROFIT),swap=PositionGetDouble(POSITION_SWAP);
  floatingPnl+=profit+swap;
  result+="{\"id\":\""+IntegerToString(PositionGetInteger(POSITION_IDENTIFIER))+"\",\"symbol\":\""+Esc(PositionGetString(POSITION_SYMBOL))+"\",\"side\":\""+(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?"BUY":"SELL")+"\",\"volume\":"+DoubleToString(PositionGetDouble(POSITION_VOLUME),8)+",\"sl\":"+DoubleToString(PositionGetDouble(POSITION_SL),10)+",\"tp\":"+DoubleToString(PositionGetDouble(POSITION_TP),10)+",\"magic\":"+IntegerToString(PositionGetInteger(POSITION_MAGIC))+",\"details\":{\"openPrice\":"+DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN),10)+",\"currentPrice\":"+DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT),10)+",\"profit\":"+DoubleToString(profit,8)+",\"swap\":"+DoubleToString(swap,8)+"}}";
 }
 if(PositionsTotal()!=total)return "";
 return result+"]";
}
// The claim file is never overwritten: even an empty/torn result means "pending".
string ReadJournal(string id){
 string claim=Prefix()+id+".claim",result=Prefix()+id+".result";
 if(!FileIsExist(claim,FILE_COMMON))return "";
 int f=FileOpen(result,FILE_READ|FILE_TXT|FILE_ANSI|FILE_COMMON);
 if(f==INVALID_HANDLE)return "pending";
 string value=FileReadString(f);FileClose(f);
 if(StringFind(value,"done|")==0||StringFind(value,"failed|")==0||StringFind(value,"uncertain|")==0)return value;
 return "pending";
}
bool Journal(string id,string value){
 string claim=Prefix()+id+".claim";
 if(!FileIsExist(claim,FILE_COMMON)){
  int f=FileOpen(claim,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);if(f==INVALID_HANDLE)return false;
  bool ok=FileWriteString(f,"pending")>0;FileFlush(f);FileClose(f);if(!ok)return false;
 }
 if(value=="pending")return true;
 int f=FileOpen(Prefix()+id+".result",FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);if(f==INVALID_HANDLE)return false;
 bool ok=FileWriteString(f,value)>0;FileFlush(f);FileClose(f);return ok;
}
void Ack(string id,string status,string message,string code=""){ackId=id;ackStatus=status;ackCode=code;ackMessage=StringSubstr(message,0,240);Print("Copy ",id," ",status," ",ackMessage);}
void Complete(string id,string status,string message){if(!Journal(id,status+"|"+message)){Ack(id,"uncertain","Journal local indisponible après exécution : contrôler le terminal");return;}Ack(id,status,message);}
bool TradeOk(bool sent){uint code=copier.ResultRetcode();return sent&&(code==TRADE_RETCODE_DONE||code==TRADE_RETCODE_DONE_PARTIAL||code==TRADE_RETCODE_NO_CHANGES);}
double TotalLots(){double sum=0;for(int i=0;i<PositionsTotal();i++)if(PositionGetTicket(i)>0)sum+=PositionGetDouble(POSITION_VOLUME);return sum;}
double OwnedVolume(ulong magic,string symbol,string side,bool &consistent){
 double sum=0;consistent=true;
 for(int i=0;i<PositionsTotal();i++)if(PositionGetTicket(i)>0&&(ulong)PositionGetInteger(POSITION_MAGIC)==magic){
  if(PositionGetString(POSITION_SYMBOL)!=symbol||(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?"BUY":"SELL")!=side)consistent=false;
  sum+=PositionGetDouble(POSITION_VOLUME);
 }
 return sum;
}
bool StopsMatch(ulong magic,double sl,double tp,double point){
 for(int i=0;i<PositionsTotal();i++)if(PositionGetTicket(i)>0&&(ulong)PositionGetInteger(POSITION_MAGIC)==magic)
  if(MathAbs(PositionGetDouble(POSITION_SL)-sl)>point/2||MathAbs(PositionGetDouble(POSITION_TP)-tp)>point/2)return false;
 return true;
}
void RejectPreflight(string id,string saved,string json,ulong magic,string symbol,string side,string code,string message){
 bool consistent=false;double current=OwnedVolume(magic,symbol,side,consistent);
 // No trade was sent, no prior execution claim exists, and no position has this magic.
 if(saved==""&&Num(json,"fromVolume")==0&&Num(json,"volume")>0&&current==0&&consistent)Ack(id,"skipped",message,code);
 else Ack(id,"uncertain",message+" ; copie existante ou résultat précédent à vérifier");
}
void Execute(string json){
 if(Role!=SLAVE)return;
 string id=Str(json,"id");if(!SafeId(id))return;
 string saved=ReadJournal(id);
 if(StringFind(saved,"done|")==0||StringFind(saved,"failed|")==0||StringFind(saved,"uncertain|")==0){int split=StringFind(saved,"|");Ack(id,StringSubstr(saved,0,split),StringSubstr(saved,split+1));return;}
 if(Str(json,"account")!=Account()||Str(json,"server")!=AccountInfoString(ACCOUNT_SERVER)||Str(json,"mode")!=Mode()){Ack(id,"failed","Identité MT5 différente");return;}
 if(Mode()=="real"&&!AllowRealTrading){Ack(id,"failed","AllowRealTrading désactivé sur le terminal");return;}
 if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING){Ack(id,"failed","Compte hedging requis");return;}
 string symbol=Str(json,"symbol"), side=Str(json,"side");
 double raw=Num(json,"volume"),sl=Num(json,"sl"),tp=Num(json,"tp"),magicValue=Num(json,"magic");
 if(raw<0||sl<0||tp<0||magicValue<=0||symbol==""||(side!="BUY"&&side!="SELL")){Ack(id,"failed","Commande invalide");return;}
 ulong magic=(ulong)magicValue;
 if(!SymbolSelect(symbol,true)){RejectPreflight(id,saved,json,magic,symbol,side,"symbol_unavailable",symbol+" : symbole indisponible sur ce compte ; vérifier son nom exact et le mapping");return;}
 double step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP),minimum=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN),maximum=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX),point=SymbolInfoDouble(symbol,SYMBOL_POINT);
 if(step<=0||minimum<=0||point<=0){RejectPreflight(id,saved,json,magic,symbol,side,"symbol_specs_unavailable",symbol+" : spécifications de volume ou de prix indisponibles");return;}
 double target=NormalizeDouble(MathFloor((raw+1e-9)/step)*step,8);
 int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);sl=NormalizeDouble(sl,digits);tp=NormalizeDouble(tp,digits);
 if(raw>0&&target<minimum){RejectPreflight(id,saved,json,magic,symbol,side,"volume_below_minimum",symbol+" : demandé "+DoubleToString(raw,8)+", arrondi "+DoubleToString(target,8)+", minimum "+DoubleToString(minimum,8)+", pas "+DoubleToString(step,8)+" lot(s). Ajuster les limites pour ce symbole si souhaité.");return;}
 bool consistent=false;double current=OwnedVolume(magic,symbol,side,consistent);
 if(!consistent){Ack(id,"uncertain","Magic partagé avec une position différente");return;}
 if(saved=="pending"){
  if(MathAbs(current-target)<step/2&&StopsMatch(magic,sl,tp,point))Complete(id,"done","État réconcilié après interruption");
  else Complete(id,"uncertain","Résultat précédent inconnu : vérifier avant tout réessai");
  return;
 }
 // A reduction or SL/TP command must never reopen an externally closed copy.
 double expected=Num(json,"fromVolume");
 if(expected<0||MathAbs(current-expected)>=step/2){Complete(id,"uncertain","Volume modifié depuis le snapshot : aucune nouvelle exécution");return;}
 double expires=Num(json,"expiresAt");
 if(expires>0&&(double)TimeGMT()*1000>expires){Complete(id,"failed","Commande d’ouverture expirée");return;}
 if(target>current+step/2){
  double floor=Num(json,"lossFloor"),cap=Num(json,"maxTotalLots");
  if(target>TerminalMaxLot+1e-8||target>maximum||TotalLots()+target-current>MathMin(TerminalMaxTotalLots,cap)+1e-8){Complete(id,"failed","Limite de lots terminal ou serveur");return;}
  if(AccountInfoDouble(ACCOUNT_EQUITY)<=MathMax(floor,startingEquity*(1-TerminalLossLimitPercent/100))){Complete(id,"failed","Limite de perte terminal ou serveur");return;}
  double margin=0;MqlTick tick;
  if(!SymbolInfoTick(symbol,tick)||!OrderCalcMargin(side=="BUY"?ORDER_TYPE_BUY:ORDER_TYPE_SELL,symbol,target-current,side=="BUY"?tick.ask:tick.bid,margin)||margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE)){Complete(id,"failed","Marge insuffisante ou cotation absente");return;}
 }
 if(!Journal(id,"pending")){Ack(id,"failed","Impossible de journaliser avant exécution");return;}
 copier.SetExpertMagicNumber(magic);copier.SetDeviationInPoints(DeviationPoints);copier.SetTypeFillingBySymbol(symbol);copier.SetAsyncMode(false);
 if(target>current+step/2){
  double delta=NormalizeDouble(target-current,8);
  bool ok=side=="BUY"?copier.Buy(delta,symbol,0,sl,tp,"Copy "+StringSubstr(id,0,23)):copier.Sell(delta,symbol,0,sl,tp,"Copy "+StringSubstr(id,0,23));
  if(!TradeOk(ok)){Complete(id,"failed",copier.ResultRetcodeDescription());return;}
 }else if(target<current-step/2){
  double remaining=current-target;
  for(int i=PositionsTotal()-1;i>=0&&remaining>step/2;i--){
   ulong ticket=PositionGetTicket(i);if(ticket==0||(ulong)PositionGetInteger(POSITION_MAGIC)!=magic)continue;
   double volume=PositionGetDouble(POSITION_VOLUME),cut=NormalizeDouble(MathMin(volume,remaining),8);
   bool ok=cut>=volume-step/2?copier.PositionClose(ticket):copier.PositionClosePartial(ticket,cut);
   if(!TradeOk(ok)){Complete(id,"failed",copier.ResultRetcodeDescription());return;}
   remaining-=cut;
  }
 }
 for(int i=PositionsTotal()-1;i>=0;i--){ulong ticket=PositionGetTicket(i);if(ticket==0||(ulong)PositionGetInteger(POSITION_MAGIC)!=magic)continue;
  if(MathAbs(PositionGetDouble(POSITION_SL)-sl)>point/2||MathAbs(PositionGetDouble(POSITION_TP)-tp)>point/2)
   if(!TradeOk(copier.PositionModify(ticket,sl,tp))){Complete(id,"failed",copier.ResultRetcodeDescription());return;}
 }
 current=OwnedVolume(magic,symbol,side,consistent);
 if(!consistent||MathAbs(current-target)>=step/2){Complete(id,"uncertain","Volume exécuté partiel : vérifier le terminal");return;}
 Complete(id,"done","Synchronisation exécutée");
}
// Broker-day trading result, excluding deposits/withdrawals and credit operations.
string Metrics(double floatingPnl){
 datetime now=TimeCurrent();MqlDateTime parts;TimeToStruct(now,parts);
 parts.hour=0;parts.min=0;parts.sec=0;datetime day=StructToTime(parts);
 string date=TimeToString(day,TIME_DATE);StringReplace(date,".","-");
 bool historyOk=HistorySelect(day,now);double realized=0;int deals=0;
 if(historyOk)for(int i=0;i<HistoryDealsTotal();i++){
  ulong ticket=HistoryDealGetTicket(i);if(ticket==0){historyOk=false;break;}
  long type=HistoryDealGetInteger(ticket,DEAL_TYPE);
  if(type!=DEAL_TYPE_BUY&&type!=DEAL_TYPE_SELL)continue;
  realized+=HistoryDealGetDouble(ticket,DEAL_PROFIT)+HistoryDealGetDouble(ticket,DEAL_SWAP)+HistoryDealGetDouble(ticket,DEAL_COMMISSION)+HistoryDealGetDouble(ticket,DEAL_FEE);deals++;
 }
 return "{\"balance\":"+DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),8)+",\"currency\":\""+Esc(AccountInfoString(ACCOUNT_CURRENCY))+"\",\"floatingPnl\":"+DoubleToString(floatingPnl,8)+",\"realizedDay\":"+(historyOk?DoubleToString(realized,8):"null")+",\"dealsDay\":"+(historyOk?IntegerToString(deals):"null")+",\"day\":\""+date+"\"}";
}
void Sync(){
 if(!TerminalInfoInteger(TERMINAL_CONNECTED)){Comment("CopyTrading : terminal déconnecté du broker, transmission suspendue.");return;}
 if(busy)return;busy=true;
 double floatingPnl=0;string positions=Positions(floatingPnl);if(positions==""){busy=false;return;}sequence++;
 string payload="{\"role\":\""+(Role==MASTER?"master":"slave")+"\",\"account\":\""+Account()+"\",\"server\":\""+Esc(AccountInfoString(ACCOUNT_SERVER))+"\",\"mode\":\""+Mode()+"\",\"hedging\":"+(AccountInfoInteger(ACCOUNT_MARGIN_MODE)==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING?"true":"false")+",\"session\":\""+sessionId+"\",\"seq\":"+IntegerToString(sequence)+",\"equity\":"+DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2)+",\"positions\":"+positions;
 payload+=",\"metrics\":"+Metrics(floatingPnl);
 if(ackId!="")payload+=",\"ack\":{\"id\":\""+ackId+"\",\"status\":\""+ackStatus+"\",\"message\":\""+Esc(ackMessage)+"\",\"code\":\""+Esc(ackCode)+"\"}";
 payload+="}";
 char body[],response[];string headers;
 StringToCharArray(payload,body,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(body,ArraySize(body)-1);
 int code=WebRequest("POST",effectiveApiUrl+"/api/copytrading/agent","Content-Type: application/json\r\nX-Copy-Agent-Id: "+effectiveAgentId+"\r\nX-Copy-Agent-Key: "+effectiveAgentKey+"\r\n",5000,body,response,headers);
 string json=CharArrayToString(response,0,-1,CP_UTF8);
 if(code==200){ackId="";ackStatus="";ackMessage="";ackCode="";if(StringFind(json,"\"command\":{")>=0)Execute(json);Comment("CopyTrading ",Role==MASTER?"MASTER":"SLAVE"," connecté\n",Account()," / ",AccountInfoString(ACCOUNT_SERVER));}
 else {Print("Copy API HTTP=",code," ",StringSubstr(json,0,300));Comment("CopyTrading : connexion refusée / indisponible. HTTP ",code);}
 busy=false;
}
int OnInit(){
 effectiveAgentId=CredentialInput(AgentId,"AgentId");
 effectiveAgentKey=CredentialInput(AgentKey,"AgentKey");
 effectiveApiUrl=TrimInput(ApiBaseUrl);
 while(StringLen(effectiveApiUrl)>0&&StringSubstr(effectiveApiUrl,StringLen(effectiveApiUrl)-1)=="/")effectiveApiUrl=StringSubstr(effectiveApiUrl,0,StringLen(effectiveApiUrl)-1);
 if(!SafeId(effectiveAgentId))return InvalidParameter("AgentId invalide : UUID de 36 caractères attendu, reçu "+IntegerToString(StringLen(effectiveAgentId))+" caractères. Copiez uniquement la valeur AgentId du terminal.");
 if(!HexKey(effectiveAgentKey))return InvalidParameter("AgentKey invalide : 64 caractères (0-9, a-f) attendus, reçu "+IntegerToString(StringLen(effectiveAgentKey))+" caractères. Copiez la clé du terminal, pas la clé administrateur ni les deux lignes ensemble.");
 if(Role!=MASTER&&Role!=SLAVE)return InvalidParameter("Role doit être MASTER ou SLAVE.");
 if(PollSeconds<1)return InvalidParameter("PollSeconds doit être au moins égal à 1.");
 if(StringFind(effectiveApiUrl,"https://")!=0&&StringFind(effectiveApiUrl,"http://localhost:")!=0)return InvalidParameter("ApiBaseUrl doit être l’URL HTTPS de l’application, par exemple https://derivbot-qnwz.onrender.com.");
 // Execution limits apply to followers; the master only reports positions.
 if(Role==SLAVE){
  if(!MathIsValidNumber(TerminalMaxLot)||TerminalMaxLot<=0)return InvalidParameter("TerminalMaxLot doit être supérieur à 0 sur un suiveur.");
  if(!MathIsValidNumber(TerminalMaxTotalLots)||TerminalMaxTotalLots<=0)return InvalidParameter("TerminalMaxTotalLots doit être supérieur à 0 sur un suiveur.");
  if(!MathIsValidNumber(TerminalLossLimitPercent)||TerminalLossLimitPercent<=0||TerminalLossLimitPercent>100)return InvalidParameter("TerminalLossLimitPercent doit être supérieur à 0 et au maximum égal à 100 sur un suiveur.");
  if(DeviationPoints<0)return InvalidParameter("DeviationPoints doit être positif ou nul sur un suiveur.");
  if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)return InvalidParameter("SLAVE exige un compte hedging. Pour le compte source, choisissez MASTER.");
 }
 lockHandle=FileOpen(Prefix()+"agent.lock",FILE_READ|FILE_WRITE|FILE_BIN|FILE_COMMON);
 if(lockHandle==INVALID_HANDLE){Print("Un autre EA utilise cette identité sur cette machine");return INIT_FAILED;}
 startingEquity=AccountInfoDouble(ACCOUNT_EQUITY);
 sessionId=IntegerToString((long)TimeLocal())+"-"+IntegerToString((long)GetMicrosecondCount())+"-"+IntegerToString(ChartID());
 if(!EventSetTimer(PollSeconds)){Print("CopyTrading : impossible de démarrer le minuteur. Erreur ",GetLastError());FileClose(lockHandle);lockHandle=INVALID_HANDLE;return INIT_FAILED;}
 Print("CopyTrading 1.03 : paramètres validés, connexion au serveur au prochain cycle.");
 return INIT_SUCCEEDED;
}
void OnTimer(){Sync();}
void OnDeinit(const int reason){EventKillTimer();if(lockHandle!=INVALID_HANDLE)FileClose(lockHandle);Comment("");}
