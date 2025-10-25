const hre = require("hardhat");
var frontendUtil = require('@arcologynetwork/frontend-util/utils/util')
const nets = require('../../network.json');

async function main() {
  
  accounts = await ethers.getSigners(); 
  const provider = new ethers.providers.JsonRpcProvider(nets[hre.network.name].url);
  const pkCreator=nets[hre.network.name].accounts[0]
  const signerCreator = new ethers.Wallet(pkCreator, provider);
  const txbase = 'benchmark/token/txs';
  frontendUtil.ensurePath(txbase);
  


  const tokenCount=20;  //Token number
  const poolStyle=2;    //Liquidity Pool Organization
                        // 2 - (tokenA tokenB)  (tokenC tokenD)   
                        // 1 - (tokenA tokenB)  (tokenB tokenC)  (tokenC tokenD)

  
  const trnsferMode=false;

  
  let i,tx;

  console.log('===========start create Token=====================')
  const tokenFactory = await ethers.getContractFactory("Token");
  var tokenInsArray=new Array();
  for(i=0;i<tokenCount;i++){
    const tokenIns = await tokenFactory.deploy("token"+i, "TKN"+i);
    await tokenIns.deployed();
    tokenInsArray.push(tokenIns);
    console.log(`Deployed token${i} at ${tokenIns.address}`);
  }
  

  let accountsLength=accounts.length
  let sendCount=100
  var txs=new Array();
  if(trnsferMode){
    console.log('===========start mint token=====================')
    let j;
    for (i=0;i<tokenCount;i++) {
      for(j=0;j+1<accountsLength;j=j+2){
        amount=ethers.utils.parseUnits("1", 18).mul(j%4+1);

        txs=await batchSendTxs(txs,sendCount,frontendUtil.generateTx(function([token,reciver,amount]){
          return token.mint(reciver,amount);
        },tokenInsArray[i],accounts[j].address,amount));
      }
    }
    txs=await batchSendTxs(txs,sendCount,0);

  
    console.log('===========start transfer token=====================')
    for (i=0;i<tokenCount;i++) {
      for(j=0;j+1<accountsLength;j=j+2){
        amount=ethers.utils.parseUnits("1", 18).mul(j%4+1);
        txs=await batchSendTxs(txs,sendCount,frontendUtil.generateTx(function([token,from,to,amount]){
              return token.connect(from).transfer(to,amount);
            },tokenInsArray[i],accounts[j],accounts[j+1].address,amount));

      }
    }
    txs=await batchSendTxs(txs,sendCount,0);

    console.log('===========start approve token=====================')
    for (i=0;i<tokenCount;i++) {
      for(j=0;j+1<accountsLength;j=j+2){
        amount=ethers.utils.parseUnits("1", 18).mul(j%4+1);
        txs=await batchSendTxs(txs,sendCount,frontendUtil.generateTx(function([token,from,routerAdr,amount]){
          return token.connect(from).approve(routerAdr,amount);
        },tokenInsArray[i],accounts[j+1],accounts[j].address,amount));
      }
    }
    txs=await batchSendTxs(txs,sendCount,0);

    console.log('===========start transferFrom token=====================')
    for (i=0;i<tokenCount;i++) {
      for(j=0;j+1<accountsLength;j=j+2){
        amount=ethers.utils.parseUnits("1", 18).mul(j%4+1);
        txs=await batchSendTxs(txs,sendCount,frontendUtil.generateTx(function([token,from,to,amount]){
          return token.connect(to).transferFrom(from.address,to.address,amount);
            },tokenInsArray[i],accounts[j+1],accounts[j],amount));
      }
    }
    txs=await batchSendTxs(txs,sendCount,0);
  }else{

    frontendUtil.ensurePath(txbase + '/mint');
    const handle_token_mint = frontendUtil.newFile(txbase + '/mint/mint.out');
    
    frontendUtil.ensurePath(txbase + '/transfer');
    const handle_transfer=frontendUtil.newFile(txbase + '/transfer/transfer.out')

    frontendUtil.ensurePath(txbase + '/approve');
    const handle_swap_token_approve=frontendUtil.newFile(txbase + '/approve/approve.out')

    frontendUtil.ensurePath(txbase + '/transfer-from');
    const handle_transfer_from=frontendUtil.newFile(txbase + '/transfer-from/transfer-from.out')

    let pk,signer,pk1,signer1

    for (i=0;i<tokenCount;i++) {
      for(j=0;j+1<accountsLength;j=j+2){
        amount=ethers.utils.parseUnits("1", 18).mul(j%4+1);
        console.log(`swap: ${amount} at i:${i} j:${j}`);

        pk=nets[hre.network.name].accounts[j];
        signer = new ethers.Wallet(pk, provider);

        pk1=nets[hre.network.name].accounts[j+1];
        signer1 = new ethers.Wallet(pk1, provider);

        //mint
        tx = await tokenInsArray[i].populateTransaction.mint(accounts[j].address,amount);
        await writePreSignedTxFile(handle_token_mint,signerCreator,tx);

        //transfer
        tx = await tokenInsArray[i].connect(accounts[j]).populateTransaction.transfer(accounts[j+1].address,amount);
        await writePreSignedTxFile(handle_transfer,signer,tx);

        //approve
        tx = await tokenInsArray[i].connect(accounts[j+1]).populateTransaction.approve(accounts[j].address,amount);
        await writePreSignedTxFile(handle_swap_token_approve,signer1,tx);

        //transferFrom
        tx = await tokenInsArray[i].connect(accounts[j]).populateTransaction.transferFrom(accounts[j+1].address,accounts[j].address,amount);
        await writePreSignedTxFile(handle_transfer_from,signer,tx);

      }
    }
    
  }
  
  
}

async function batchSendTxs(txs,batchCounts,tx){
  if(tx!=0) txs.push(tx);
  if(txs.length>=batchCounts){
    await frontendUtil.waitingTxs(txs);
    console.log(`send successful ${txs.length}`);
    txs=new Array();
  }
  return txs;
}

async function writePreSignedTxFile(txfile,signer,tx){
  const fulltx=await signer.populateTransaction(tx)
  const rawtx=await signer.signTransaction(fulltx)
  frontendUtil.appendTo(txfile,rawtx+',\n')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
