"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import {
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  erc20Abi,
  KZN_STAKING_ADDRESS,
  KZN_TOKEN_ADDRESS,
  stakingAbi,
} from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

function formatTokenAmount(value?: bigint) {
  if (value === undefined) return "0";
  return Number(formatUnits(value, 18)).toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [stakeInput, setStakeInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [currentAction, setCurrentAction] = useState<"approve" | "stake" | "claim" | "withdraw" | null>(null);
  const { address, isConnected, chainId } = useConnection();
  const { mutateAsync: connectAsync, isPending: isConnecting } = useConnect();
  const connectors = useConnectors();
  const { mutateAsync: disconnectAsync } = useDisconnect();
  const { mutateAsync: writeContractAsync, data: txHash, isPending: isWriting, error: writeError } = useWriteContract();
  const {
    data: txReceipt,
    error: receiptError,
    isError: isReceiptError,
    isLoading: isConfirming,
    isSuccess: isReceiptSuccess,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const connectedOnSepolia = isMounted && isConnected && chainId === 11155111;
  const selectedConnector = connectors[0];
  const txPending = isWriting || isConfirming;

  const { data: walletBalance, refetch: refetchBalance } = useReadContract({
    address: KZN_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: KZN_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, KZN_STAKING_ADDRESS] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: userInfo, refetch: refetchUserInfo } = useReadContract({
    address: KZN_STAKING_ADDRESS,
    abi: stakingAbi,
    functionName: "users",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: pendingRewards, refetch: refetchRewards } = useReadContract({
    address: KZN_STAKING_ADDRESS,
    abi: stakingAbi,
    functionName: "pendingRewards",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: stakingTokenAddress } = useReadContract({
    address: KZN_STAKING_ADDRESS,
    abi: stakingAbi,
    functionName: "stakingToken",
  });

  const stakeAmountWei = useMemo(() => {
    if (!stakeInput) return BigInt(0);
    try {
      return parseUnits(stakeInput, 18);
    } catch {
      return BigInt(0);
    }
  }, [stakeInput]);

  const withdrawAmountWei = useMemo(() => {
    if (!withdrawInput) return BigInt(0);
    try {
      return parseUnits(withdrawInput, 18);
    } catch {
      return BigInt(0);
    }
  }, [withdrawInput]);

  const needsApproval =
    stakeAmountWei > BigInt(0) && (allowance ?? BigInt(0)) < stakeAmountWei;
  const hasTokenMismatch =
    Boolean(stakingTokenAddress) &&
    stakingTokenAddress!.toLowerCase() !== KZN_TOKEN_ADDRESS.toLowerCase();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refetchBalance(),
      refetchAllowance(),
      refetchUserInfo(),
      refetchRewards(),
    ]);
  }, [refetchAllowance, refetchBalance, refetchRewards, refetchUserInfo]);

  function approve() {
    if (!connectedOnSepolia || stakeAmountWei <= BigInt(0)) {
      toast.error("Enter a valid amount on Sepolia before approving.");
      return;
    }
    setCurrentAction("approve");
    void writeContractAsync({
      address: KZN_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [KZN_STAKING_ADDRESS, stakeAmountWei],
    });
  }

  function stake() {
    if (!connectedOnSepolia || stakeAmountWei <= BigInt(0)) {
      toast.error("Enter a valid amount on Sepolia before staking.");
      return;
    }
    if ((walletBalance ?? BigInt(0)) < stakeAmountWei) {
      toast.error("Insufficient KZN balance for this stake amount.");
      return;
    }
    if ((allowance ?? BigInt(0)) < stakeAmountWei) {
      toast.error("Approve KZN first (allowance is too low).");
      return;
    }
    if (hasTokenMismatch) {
      toast.error("Staking contract token mismatch. Redeploy staking with correct token.");
      console.error("stakingToken mismatch", {
        stakingTokenAddress,
        frontendTokenAddress: KZN_TOKEN_ADDRESS,
        stakingAddress: KZN_STAKING_ADDRESS,
      });
      return;
    }
   
    setCurrentAction("stake");
    void writeContractAsync({
      address: KZN_STAKING_ADDRESS,
      abi: stakingAbi,
      functionName: "stake",
      args: [stakeAmountWei],
    });
  }

  function withdraw() {
    if (!connectedOnSepolia || withdrawAmountWei <= BigInt(0)) {
      toast.error("Enter a valid amount on Sepolia before withdrawing.");
      return;
    }
    if ((userInfo?.[0] ?? BigInt(0)) < withdrawAmountWei) {
      toast.error("Withdraw amount exceeds your staked balance.");
      return;
    }
    setCurrentAction("withdraw");
    void writeContractAsync({
      address: KZN_STAKING_ADDRESS,
      abi: stakingAbi,
      functionName: "withdraw",
      args: [withdrawAmountWei],
    });
  }

  function claim() {
    if (!connectedOnSepolia) {
      toast.error("Switch to Sepolia before claiming rewards.");
      return;
    }
    if ((pendingRewards ?? BigInt(0)) <= BigInt(0)) {
      toast.error("No rewards available to claim yet.");
      return;
    }
    setCurrentAction("claim");
    void writeContractAsync({
      address: KZN_STAKING_ADDRESS,
      abi: stakingAbi,
      functionName: "claimRewards",
      args: [],
    });
  }

  useEffect(() => {
    if (writeError) {
      toast.error(writeError.message.split("\n")[0] ?? "Transaction failed.");
      setCurrentAction(null);
    }
  }, [writeError]);

  useEffect(() => {
    if (!isReceiptError || !receiptError) return;
    console.error("Transaction receipt error:", receiptError);
    toast.error(receiptError.message.split("\n")[0] ?? "Failed to fetch transaction receipt.");
    setCurrentAction(null);
    toast.dismiss("tx-status");
  }, [isReceiptError, receiptError]);

  useEffect(() => {
    if (!currentAction) return;
    if (isWriting) {
      toast.loading(`Sending ${currentAction} transaction...`, { id: "tx-status" });
      return;
    }
    if (isConfirming) {
      toast.loading("Waiting for blockchain confirmation...", { id: "tx-status" });
      return;
    }

    if (!txHash || txPending || !isReceiptSuccess || !txReceipt) return;

    if (txReceipt.status === "success") {
      toast.success(`${currentAction} successful`, { id: "tx-status" });
    } else {
      console.error("Transaction reverted:", {
        action: currentAction,
        txHash,
        receipt: txReceipt,
      });
      toast.error(`${currentAction} failed on-chain (reverted).`, { id: "tx-status" });
    }

    setCurrentAction(null);
  }, [
    currentAction,
    isConfirming,
    isReceiptSuccess,
    isWriting,
    txHash,
    txPending,
    txReceipt,
  ]);

  useEffect(() => {
    if (txReceipt && txReceipt.status === "success") {
      setCurrentAction(null);
      void refreshAll();
    }
  }, [refreshAll, txReceipt]);

  const approveLabel = txPending && currentAction === "approve" ? "Approving..." : "Approve";
  const stakeLabel = txPending && currentAction === "stake" ? "Staking..." : "Stake";
  const claimLabel = txPending && currentAction === "claim" ? "Claiming..." : "Claim Rewards";
  const withdrawLabel = txPending && currentAction === "withdraw" ? "Withdrawing..." : "Withdraw";

  return (
    <main className="min-h-screen bg-linear-to-b from-background/80 via-background/60 to-background/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Sepolia</Badge>
              <Badge>
                {!isMounted ? "Checking Network" : connectedOnSepolia ? "Network Ready" : "Switch Network"}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Kaizen Staking Dashboard</h1>
            <p className="text-muted-foreground">
              Professional KZN staking interface with live balances and transaction controls.
            </p>
          </div>
          {!isMounted || !isConnected ? (
            <Button
              onClick={() => {
                if (!selectedConnector) return;
                void connectAsync({ connector: selectedConnector });
              }}
              disabled={isConnecting || !selectedConnector}
              size="lg"
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => void refreshAll()} disabled={txPending}>
                Refresh
              </Button>
              <Button variant="destructive" onClick={() => void disconnectAsync()}>
                Disconnect
              </Button>
            </div>
          )}
        </header>

        {isMounted && isConnected ? (
          <Alert className="border-white/30 bg-white/15 backdrop-blur-xl">
            <AlertTitle>Connected wallet</AlertTitle>
            <AlertDescription className="break-all">
              {address} {connectedOnSepolia ? "(Sepolia)" : "(wrong network)"}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-white/30 bg-white/15 backdrop-blur-xl">
            <AlertTitle>Wallet not connected</AlertTitle>
            <AlertDescription>
              Connect your wallet to stake KZN. Make sure MetaMask is on Sepolia.
            </AlertDescription>
          </Alert>
        )}
        {hasTokenMismatch ? (
          <Alert className="border-destructive/60 bg-destructive/10 backdrop-blur-xl">
            <AlertTitle>Staking config mismatch</AlertTitle>
            <AlertDescription className="break-all">
              stakingToken() = {stakingTokenAddress}, but KZN token = {KZN_TOKEN_ADDRESS}.
              Redeploy staking with the correct token address and update `.env`.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border-white/25 bg-white/10 backdrop-blur-xl shadow-lg shadow-violet-500/10">
            <CardHeader>
              <CardDescription>Wallet Balance</CardDescription>
              <CardTitle>{formatTokenAmount(walletBalance)} KZN</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-white/25 bg-white/10 backdrop-blur-xl shadow-lg shadow-violet-500/10">
            <CardHeader>
              <CardDescription>Staked Amount</CardDescription>
              <CardTitle>{formatTokenAmount(userInfo?.[0])} KZN</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-white/25 bg-white/10 backdrop-blur-xl shadow-lg shadow-violet-500/10">
            <CardHeader>
              <CardDescription>Claimable Rewards</CardDescription>
              <CardTitle>{formatTokenAmount(pendingRewards)} KZN</CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-white/25 bg-white/10 backdrop-blur-xl shadow-lg shadow-violet-500/10">
            <CardHeader>
              <CardDescription>Allowance</CardDescription>
              <CardTitle>{formatTokenAmount(allowance)} KZN</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <Card className="border-white/25 bg-white/10 backdrop-blur-xl shadow-xl shadow-violet-500/10">
          <CardHeader>
            <CardTitle>Staking Actions</CardTitle>
            <CardDescription>
              Stake tokens, claim rewards, and withdraw with a smooth flow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="stake" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="stake">Stake</TabsTrigger>
                <TabsTrigger value="claim">Claim</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>

              <TabsContent value="stake" className="space-y-4 pt-4">
                <Input
                  placeholder="Amount to stake (KZN)"
                  value={stakeInput}
                  onChange={(e) => setStakeInput(e.target.value)}
                />
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={
                      !connectedOnSepolia ||
                      stakeAmountWei <= BigInt(0) ||
                      !needsApproval ||
                      txPending
                    }
                    onClick={approve}
                  >
                    {approveLabel}
                  </Button>
                  <Button
                    disabled={
                      !connectedOnSepolia ||
                      stakeAmountWei <= BigInt(0) ||
                      needsApproval ||
                      txPending
                    }
                    onClick={stake}
                  >
                    {stakeLabel}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="claim" className="space-y-4 pt-4">
                <p className="text-sm text-muted-foreground">
                  Claim accrued KZN rewards to your connected wallet.
                </p>
                <Button disabled={!connectedOnSepolia || txPending} onClick={claim}>
                  {claimLabel}
                </Button>
              </TabsContent>

              <TabsContent value="withdraw" className="space-y-4 pt-4">
                <Input
                  placeholder="Amount to withdraw (KZN)"
                  value={withdrawInput}
                  onChange={(e) => setWithdrawInput(e.target.value)}
                />
                <Button
                  disabled={
                    !connectedOnSepolia ||
                    withdrawAmountWei <= BigInt(0) ||
                    txPending
                  }
                  onClick={withdraw}
                >
                  {withdrawLabel}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Separator />

        <Card className="border-white/25 bg-white/10 backdrop-blur-xl shadow-xl shadow-violet-500/10">
          <CardHeader>
            <CardTitle>Transaction Status</CardTitle>
            <CardDescription>Live feedback for your latest wallet transaction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {txPending ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : null}
            {txHash ? (
              <p className="break-all text-sm text-muted-foreground">
                Hash: {txHash}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No transaction yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
