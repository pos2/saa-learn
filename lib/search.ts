const aliases: Record<string, string[]> = {
  s3: ["amazon s3", "simple storage service", "对象存储"],
  ec2: ["amazon ec2", "elastic compute cloud", "云服务器", "实例"],
  vpc: ["amazon vpc", "virtual private cloud", "虚拟私有云"],
  nat: ["nat gateway", "nat 网关", "网络地址转换"],
  rds: ["amazon rds", "relational database service", "关系数据库"],
  高可用: ["high availability", "highly available", "multi-az", "多可用区"],
  成本: ["cost", "cost-effective", "费用", "价格", "成本优化"],
  安全: ["security", "secure", "安全性"],
  备份: ["backup", "snapshot", "快照"],
  私有: ["private", "私网", "private subnet", "私有子网"],
};

export function getSearchConcepts(search: string) {
  const normalized = search.normalize("NFKC").trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized.split(/[\s,，、;；]+/).filter(Boolean).slice(0, 8);
  return tokens.map((token) => Array.from(new Set([token, ...(aliases[token] ?? [])])));
}
