export interface ProductPackage {
  id: string | number;
  productId: string;
  name: string;
  imageUrl?: string | null;
  price?: number | null;
  description?: string | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'DRAFT' | string;
  createdBy?: number | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PackageSummary {
  pkg_careermate: number;
  pkg_classmate: number;
  pkg_jesus_messanger: number;
  total: number;
  [key: string]: number;
}

export interface FixedPackageMeta {
  id: string;
  name: string;
  icon: string;
  badgeColor: string;
}

export interface RoleOperationTab {
  id: string;
  label: string;
  icon: string;
  badge?: string;
  badgeType?: string;
}

export const FIXED_PACKAGES: FixedPackageMeta[] = [
  {
    id: 'pkg_careermate',
    name: 'Careermate',
    icon: 'business_center',
    badgeColor: 'blue',
  },
  {
    id: 'pkg_classmate',
    name: 'Classmate',
    icon: 'school',
    badgeColor: 'emerald',
  },
  {
    id: 'pkg_jesus_messanger',
    name: 'Jesus the messanger',
    icon: 'campaign',
    badgeColor: 'purple',
  },
];

export function isProduct(nameOrId?: string): boolean {
  if (!nameOrId) return false;
  const clean = nameOrId.toLowerCase().trim();
  return FIXED_PACKAGES.some(
    (fp) => fp.id.toLowerCase() === clean || fp.name.toLowerCase() === clean
  );
}

export function isTaskForPackage(
  t: { packageName?: string; title?: string; campaignName?: string; description?: string; content?: string },
  targetPackage?: string,
  extraPackages?: { name: string; productId?: string }[]
): boolean {
  if (!targetPackage) return true;
  const cleanTarget = targetPackage.trim();
  if (!cleanTarget || cleanTarget.toLowerCase() === 'all') return true;

  const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  const normTarget = normalize(cleanTarget);

  const fixedProduct = FIXED_PACKAGES.find(
    (fp) => normalize(fp.name) === normTarget || normalize(fp.id) === normTarget
  );

  // CASE 1: targetPackage is a Product (e.g. Careermate, Classmate, Jesus the messanger)
  if (fixedProduct) {
    const fixedId = normalize(fixedProduct.id);
    const fixedName = normalize(fixedProduct.name);

    if (t.packageName && t.packageName.trim()) {
      const normTPkg = normalize(t.packageName);

      // Directly matches product name or product id
      if (normTPkg === fixedName || normTPkg === fixedId) {
        return true;
      }

      // If extraPackages provided, verify if the custom package belongs to this product
      if (extraPackages && extraPackages.length > 0) {
        const match = extraPackages.find((p) => normalize(p.name || '') === normTPkg);
        if (match && match.productId) {
          const matchProd = normalize(match.productId);
          if (matchProd === fixedId || matchProd.includes(fixedId.replace('pkg ', '')) || fixedId.includes(matchProd)) {
            return true;
          }
          // Belongs to another product
          return false;
        }
      }

      // Check product keyword prefix if not belonging to another known product
      if (fixedId.includes('career') && normTPkg.includes('career')) return true;
      if (fixedId.includes('class') && normTPkg.includes('class')) return true;
      if (fixedId.includes('jesus') && (normTPkg.includes('jesus') || normTPkg.includes('messang'))) return true;
      return false;
    }

    // Fallback for legacy tasks with no packageName: check text fields
    const combined = normalize(`${t.title || ''} ${t.description || ''} ${t.campaignName || ''} ${t.content || ''}`);
    if (fixedId.includes('career')) {
      return combined.includes('careermate') || combined.includes('career');
    }
    if (fixedId.includes('class')) {
      return combined.includes('classmate') || combined.includes('class') || combined.includes('student');
    }
    if (fixedId.includes('jesus')) {
      return combined.includes('jesus') || combined.includes('messang') || combined.includes('messenger');
    }
    return false;
  }

  // CASE 2: targetPackage is a SPECIFIC CUSTOM PACKAGE (e.g. "TNPSC Gold", "Class 10 CBSE", "General Studies")
  // Strict matching: Only tasks explicitly created for/assigned to this package match.
  if (t.packageName && t.packageName.trim()) {
    const normTPkg = normalize(t.packageName);
    return normTPkg === normTarget;
  }

  // If task has no packageName at all, it does not belong to this specific package
  return false;
}

