import type { Analysis } from "./domain";

type AliasRule = { canonical: string; aliases: string[] };

const serviceRules: AliasRule[] = [
  { canonical: "Amazon S3", aliases: ["amazon s3", "aws s3", "s3", "simple storage service", "s3 transfer acceleration", "s3 cross-region replication", "s3 cross region replication"] },
  { canonical: "Amazon EC2", aliases: ["amazon ec2", "aws ec2", "ec2", "elastic compute cloud", "aws dedicated host", "ec2 dedicated host"] },
  { canonical: "Amazon EBS", aliases: ["amazon ebs", "aws ebs", "ebs", "elastic block store"] },
  { canonical: "Amazon EFS", aliases: ["amazon efs", "aws efs", "efs", "elastic file system"] },
  { canonical: "Amazon VPC", aliases: ["amazon vpc", "aws vpc", "vpc", "virtual private cloud"] },
  { canonical: "NAT Gateway", aliases: ["nat gateway", "aws nat gateway", "amazon nat gateway", "nat 网关"] },
  { canonical: "Amazon RDS", aliases: ["amazon rds", "aws rds", "rds", "relational database service"] },
  { canonical: "Amazon Aurora", aliases: ["amazon aurora", "aws aurora"] },
  { canonical: "Amazon DynamoDB", aliases: ["amazon dynamodb", "aws dynamodb", "dynamodb"] },
  { canonical: "Amazon Redshift", aliases: ["amazon redshift", "aws redshift", "redshift"] },
  { canonical: "Amazon Athena", aliases: ["amazon athena", "aws athena", "athena"] },
  { canonical: "AWS Glue", aliases: ["aws glue", "amazon glue"] },
  { canonical: "Amazon EMR", aliases: ["amazon emr", "aws emr", "elastic mapreduce"] },
  { canonical: "Amazon CloudWatch", aliases: ["amazon cloudwatch", "aws cloudwatch", "cloudwatch logs", "amazon cloudwatch logs"] },
  { canonical: "AWS Lambda", aliases: ["aws lambda", "amazon lambda"] },
  { canonical: "Amazon CloudFront", aliases: ["amazon cloudfront", "aws cloudfront", "cloudfront"] },
  { canonical: "Amazon Route 53", aliases: ["amazon route 53", "aws route 53", "route 53", "route53"] },
  { canonical: "Elastic Load Balancing", aliases: ["elastic load balancing", "application load balancer", "network load balancer", "gateway load balancer", "aws elb", "amazon elb"] },
  { canonical: "Amazon SQS", aliases: ["amazon sqs", "aws sqs", "simple queue service"] },
  { canonical: "Amazon SNS", aliases: ["amazon sns", "aws sns", "simple notification service"] },
  { canonical: "Amazon EventBridge", aliases: ["amazon eventbridge", "aws eventbridge", "cloudwatch events"] },
  { canonical: "Amazon Kinesis", aliases: ["amazon kinesis", "aws kinesis", "kinesis data streams", "kinesis data firehose"] },
  { canonical: "AWS IAM", aliases: ["aws iam", "amazon iam", "identity and access management"] },
  { canonical: "AWS KMS", aliases: ["aws kms", "amazon kms", "key management service"] },
  { canonical: "AWS WAF", aliases: ["aws waf", "amazon waf", "web application firewall"] },
  { canonical: "AWS Direct Connect", aliases: ["aws direct connect", "amazon direct connect", "direct connect"] },
  { canonical: "AWS Snowball Edge", aliases: ["aws snowball edge", "amazon snowball edge", "snowball edge"] },
  { canonical: "Amazon Macie", aliases: ["amazon macie", "aws macie"] },
  { canonical: "Amazon GuardDuty", aliases: ["amazon guardduty", "aws guardduty", "guardduty"] },
  { canonical: "AWS Organizations", aliases: ["aws organizations", "amazon organizations"] },
];

const topicRules: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: "成本优化", pattern: /成本|费用|价格|cost|cost-effective|saving/i },
  { canonical: "运维复杂度优化", pattern: /运维|运营开销|操作复杂|operational|maintenance|管理开销/i },
  { canonical: "高可用与弹性", pattern: /高可用|弹性|扩展|容错|high availability|resilien|scal|fault/i },
  { canonical: "安全与访问控制", pattern: /安全|权限|访问控制|身份|加密|security|secure|access|iam|encrypt/i },
  { canonical: "备份与灾难恢复", pattern: /备份|恢复|灾难|快照|backup|restore|disaster|snapshot/i },
  { canonical: "数据传输与迁移", pattern: /传输|迁移|复制|transfer|migration|replication|ingest/i },
  { canonical: "网络连接", pattern: /网络|连接|路由|子网|端点|network|connect|routing|subnet|endpoint|vpc/i },
  { canonical: "数据分析", pattern: /分析|查询|日志|数据湖|analytics|query|sql|log|data lake/i },
  { canonical: "存储与数据管理", pattern: /存储|对象|文件|归档|生命周期|storage|object|file|archive|lifecycle|s3/i },
  { canonical: "数据库", pattern: /数据库|关系型|缓存|database|rds|aurora|dynamodb|cache/i },
  { canonical: "监控与可观测性", pattern: /监控|告警|指标|可观测|monitor|alarm|metric|observability/i },
  { canonical: "应用集成", pattern: /队列|消息|事件|解耦|queue|message|event|decoupl/i },
  { canonical: "计算与扩展", pattern: /计算|实例|容器|无服务器|compute|instance|container|serverless|ec2|lambda/i },
];

const knowledgeRules: AliasRule[] = [
  { canonical: "S3 Transfer Acceleration", aliases: ["amazon s3 transfer acceleration", "s3 传输加速"] },
  { canonical: "S3 Multipart Upload", aliases: ["multipart upload", "s3 分段上传", "多段上传", "分段上传"] },
  { canonical: "S3 Cross-Region Replication", aliases: ["s3 cross region replication", "s3 crr", "s3 跨区域复制"] },
  { canonical: "S3 Gateway VPC Endpoint", aliases: ["gateway vpc endpoint for s3", "amazon s3 gateway vpc endpoint", "amazon s3 网关 vpc endpoint", "s3 gateway endpoint", "s3 网关端点", "vpc 网关端点（gateway endpoint）"] },
  { canonical: "S3 Versioning and MFA Delete", aliases: ["s3 版本控制与 mfa delete", "s3 versioning", "mfa delete"] },
  { canonical: "S3 Lifecycle", aliases: ["s3 lifecycle policy", "s3 lifecycle策略", "s3 生命周期"] },
  { canonical: "Amazon Athena Querying S3", aliases: ["athena query s3", "athena 查询 s3", "使用 athena 查询 s3"] },
  { canonical: "NAT Gateway Pricing", aliases: ["nat gateway cost", "nat 网关费用"] },
  { canonical: "AWS Direct Connect", aliases: ["direct connect 专线"] },
];

function key(value: string) {
  return value.normalize("NFKC").trim().toLowerCase()
    .replace(/[（）()]/g, " ")
    .replace(/[_/–—-]+/g, " ")
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function findAlias(value: string, rules: AliasRule[]) {
  const normalized = key(value);
  for (const rule of rules) {
    if (key(rule.canonical) === normalized || rule.aliases.some((alias) => key(alias) === normalized)) return rule.canonical;
  }
  return null;
}

function canonicalService(value: string) {
  return findAlias(value, serviceRules) ?? value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function canonicalTopic(value: string) {
  return topicRules.find((rule) => rule.pattern.test(value))?.canonical ?? "架构方案选择";
}

function canonicalKnowledgeTitle(value: string) {
  const exact = findAlias(value, knowledgeRules);
  if (exact) return exact;
  return value.normalize("NFKC").trim()
    .replace(/Amazon Simple Storage Service/gi, "Amazon S3")
    .replace(/Amazon Elastic Compute Cloud/gi, "Amazon EC2")
    .replace(/\s+/g, " ");
}

function uniqueByKey(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = key(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function canonicalizeAnalysis(analysis: Analysis): Analysis {
  const knowledge = new Map<string, Analysis["knowledge"][number]>();
  for (const point of analysis.knowledge) {
    const title = canonicalKnowledgeTitle(point.title);
    const normalized = key(title);
    const existing = knowledge.get(normalized);
    knowledge.set(normalized, !existing || point.body.length + point.cue.length > existing.body.length + existing.cue.length
      ? { ...point, id: undefined, title }
      : existing);
  }
  return {
    ...analysis,
    services: uniqueByKey(analysis.services.map(canonicalService)),
    topics: uniqueByKey(analysis.topics.map(canonicalTopic)),
    keywords: uniqueByKey(analysis.keywords.map((value) => findAlias(value, serviceRules) ?? value.normalize("NFKC").trim().replace(/\s+/g, " "))),
    knowledge: Array.from(knowledge.values()),
  };
}

export const CANONICAL_TOPIC_NAMES = topicRules.map((rule) => rule.canonical).concat("架构方案选择");
