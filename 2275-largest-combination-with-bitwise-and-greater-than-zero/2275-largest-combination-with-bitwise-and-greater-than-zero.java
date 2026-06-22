class Solution {
    public int largestCombination(int[] can) {
        int[] bits = new int[32];
        for(int i=0; i<32; i++){
            for(int j=0; j<can.length; j++){
                bits[i] += (can[j] >> i) & 1;
            }
        }
        int max = 0;
        for(int n : bits){
            if(max < n){
                max = n;
            }
        }
        return max;
    }
}